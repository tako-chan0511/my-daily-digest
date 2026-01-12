import type { VercelRequest, VercelResponse } from '@vercel/node';

type GeminiApiVersion = 'v1beta' | 'v1';

type GeminiModel = {
  name?: string; // e.g. "models/gemini-2.0-flash"
  supportedGenerationMethods?: string[];
};

type GeminiListModelsResponse = {
  models?: GeminiModel[];
};

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

function isRetryableStatus(status: number): boolean {
  // Gemini/ネットワーク都合で出やすい一時エラー
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function postJsonWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  retries: number
): Promise<{ resp: Response; raw: string }> {
  let lastErr: unknown = null;

  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetchWithTimeout(url, init, timeoutMs);
      const raw = await resp.text();

      if (resp.ok) return { resp, raw };

      if (isRetryableStatus(resp.status) && i < retries) {
        // 簡易指数バックオフ（0.8s, 1.6s, 3.2s…）
        const wait = 800 * Math.pow(2, i);
        console.warn(`[WARN] Retryable status ${resp.status}. wait=${wait}ms`);
        await sleep(wait);
        continue;
      }

      return { resp, raw };
    } catch (e) {
      lastErr = e;
      if (i < retries) {
        const wait = 800 * Math.pow(2, i);
        console.warn(`[WARN] Network/timeout error. retry wait=${wait}ms err=${String((e as any)?.message ?? e)}`);
        await sleep(wait);
        continue;
      }
      throw lastErr;
    }
  }

  // ここには通常来ない
  throw lastErr ?? new Error('Unknown error');
}

/**
 * ===== Gemini (REST) =====
 */
function shortModelName(fullName: string): string {
  return fullName.replace(/^models\//, '');
}

function modelSupportsGenerateContent(m: GeminiModel): boolean {
  const methods = m.supportedGenerationMethods;
  // フィールド無しなら「試す」
  if (!Array.isArray(methods) || methods.length === 0) return true;
  return methods.includes('generateContent');
}

async function listModels(version: GeminiApiVersion, apiKey: string): Promise<GeminiModel[]> {
  const url = `https://generativelanguage.googleapis.com/${version}/models`;
  const resp = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      headers: {
        'x-goog-api-key': apiKey,
      },
    },
    15000
  );

  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`ListModels failed (${version}): ${resp.status} ${raw}`);
  }

  const data = JSON.parse(raw) as GeminiListModelsResponse;
  return Array.isArray(data?.models) ? data.models : [];
}

function isGeminiNotFoundOrUnsupported(errMsg: string): boolean {
  // 404系（モデル/バージョン不一致）
  return errMsg.includes(': 404') || errMsg.includes('"code": 404') || errMsg.includes('NOT_FOUND') || errMsg.includes('not supported');
}

async function generateContent(version: GeminiApiVersion, model: string, apiKey: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent`;

  const { resp, raw } = await postJsonWithRetry(
    url,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
      }),
    },
    30000,
    3
  );

  if (!resp.ok) {
    throw new Error(`Gemini generateContent failed (${version}/${model}): ${resp.status} ${raw}`);
  }

  const data = JSON.parse(raw) as any;
  const text: unknown = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error(`Gemini response is empty (${version}/${model}). raw=${raw}`);
  }

  return text;
}

async function generateWithAutoPick(apiKey: string, prompt: string): Promise<{ version: GeminiApiVersion; model: string; text: string }> {
  // 使いたい順（必要なら追加）
  const preferred = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-2.0-flash-lite'];

  for (const version of ['v1beta', 'v1'] as const) {
    let models: GeminiModel[] = [];
    try {
      models = await listModels(version, apiKey);
    } catch (e: any) {
      console.warn(`[WARN] listModels failed (${version}): ${String(e?.message ?? e)}`);
      continue;
    }

    const available = models
      .filter((m) => typeof m?.name === 'string')
      .map((m) => shortModelName(m.name as string))
      .filter((n) => n);

    const generateCapable = new Set(
      models
        .filter((m) => typeof m?.name === 'string' && modelSupportsGenerateContent(m))
        .map((m) => shortModelName(m.name as string))
    );

    // preferred優先 → それ以外
    const candidates: string[] = [];
    for (const p of preferred) if (available.includes(p)) candidates.push(p);
    for (const a of available) if (!candidates.includes(a)) candidates.push(a);

    for (const model of candidates) {
      if (generateCapable.size > 0 && !generateCapable.has(model)) continue;

      try {
        const text = await generateContent(version, model, apiKey, prompt);
        return { version, model, text };
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        console.warn(`[WARN] generateContent failed: ${msg}`);

        // モデル/バージョン不一致は次候補へ
        if (isGeminiNotFoundOrUnsupported(msg)) continue;

        // それ以外（認証/課金/重大エラー）は即終了
        throw e;
      }
    }
  }

  throw new Error('No working Gemini model found (checked v1beta/v1).');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('=== [VER 3.0] answer-question (Gemini auto-pick v1beta/v1 + retry) ===');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST method required.' });
  }

  const { articleText, question } = (req.body ?? {}) as { articleText?: unknown; question?: unknown };
  const geminiApiKey = process.env.GEMINI_API_KEY;

  console.log('[DEBUG] GEMINI_API_KEY set:', !!geminiApiKey);
  console.log('[DEBUG] articleText length:', typeof articleText === 'string' ? articleText.length : 0);
  console.log('[DEBUG] question provided:', typeof question === 'string' && question.trim() !== '');

  if (typeof articleText !== 'string' || articleText.trim() === '' || typeof question !== 'string' || question.trim() === '') {
    return res.status(400).json({ error: '記事本文と質問の両方が必要です。' });
  }
  if (!geminiApiKey) {
    return res.status(500).json({ error: 'Gemini APIキーがサーバーに設定されていません。' });
  }

  try {
    // 長すぎると不安定になるので制限（必要なら調整）
    const article = normalizeText(articleText).slice(0, 8000);
    const q = normalizeText(question).slice(0, 1000);

    const prompt =
      `あなたは、与えられた「記事本文」を深く理解し、自身の持つ広範な専門知識と組み合わせて洞察を提供する、優秀な専門アナリストです。\n\n` +
      `ユーザーからの「質問」に対して、以下の指示に従って回答を生成してください。\n\n` +
      `1. まず「記事本文」に書かれている情報を最優先の根拠（一次情報）とする。\n` +
      `2. その上で、あなたの専門知識を補足情報として活用し、多角的に回答する。\n` +
      `3. 記事に直接書かれていない推論/予測は、あなた自身の考察であることを明示する。\n` +
      `4. 回答は必ずMarkdownで、見出し/太字/箇条書きを使って構造化する。\n\n` +
      `---記事本文---\n${article}\n\n` +
      `---質問---\n${q}\n\n` +
      `---回答---\n`;

    const generated = await generateWithAutoPick(geminiApiKey, prompt);
    console.log('[DEBUG] Gemini picked:', { version: generated.version, model: generated.model });

    return res.status(200).json({ answer: generated.text.trim() });
  } catch (error: any) {
    console.error('An error occurred in answer-question handler:', error?.message ?? error);
    return res.status(500).json({ error: error?.message ?? 'サーバーでエラーが発生しました。' });
  }
}
