import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS対応：Preflightリクエストの許可
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: "POST method required." });
  }

  const { articleText } = req.body;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!articleText || typeof articleText !== 'string') {
    return res.status(400).json({ error: '要約するための記事本文が必要です。' });
  }
  if (!geminiApiKey) {
    return res.status(500).json({ error: 'Gemini APIキーがサーバーに設定されていません。' });
  }

  try {
    // 1. SDKを初期化（環境変数からキーを読み込む）
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    
    // 2. モデルの取得
    // 重要：apiVersion: 'v1' を指定することで、404 (v1beta) エラーを回避します
    const model = genAI.getGenerativeModel(
      { model: "gemini-1.5-flash" }, 
      { apiVersion: 'v1' }
    );

    const prompt = `以下の記事を、Markdown形式で構造化して要約してください。見出し、太字、箇条書きリストなどを効果的に使用し、最も重要なポイントがひと目で分かるようにまとめてください。\n\n記事本文：\n${articleText}`;

    // 3. コンテンツ生成
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const summary = response.text();

    if (!summary) throw new Error('AIからの応答が空です。');

    // 正常なレスポンスを返す
    res.status(200).json({ summary: summary.trim() });

  } catch (error: any) {
    // Vercelの Runtime Logs に詳細を出力
    console.error('Gemini API Error Detail:', error);
    
    // フロントエンドに具体的なエラー内容を通知
    res.status(500).json({ 
      error: `AI APIがエラー: ${error.message || 'Unknown error'}` 
    });
  }
}