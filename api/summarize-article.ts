import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "POST method required." });
  }

  // フロントからAPIキーを受け取るのをやめる
  const { articleText } = req.body;
  // サーバーの環境変数から直接APIキーを読み込む
  const geminiApiKey = process.env.GEMINI_API_KEY;
  
  // デバッグログ
  console.log('[DEBUG] GEMINI_API_KEY set:', !!geminiApiKey);
  console.log('[DEBUG] articleText length:', articleText?.length || 0);

  if (!articleText || typeof articleText !== 'string') {
    return res.status(400).json({ error: '要約するための記事本文が必要です。' });
  }
  if (!geminiApiKey) {
    // エラーメッセージを分かりやすく変更
    return res.status(500).json({ error: 'Gemini APIキーがサーバーに設定されていません。' });
  }

  try {
    const prompt = `以下の記事を、Markdown形式で構造化して要約してください。見出し、太字、箇条書きリストなどを効果的に使用し、最も重要なポイントがひと目で分かるようにまとめてください。\n\n記事本文：\n${articleText}`;
    
    // サーバーのキーを使用
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
    console.log('[DEBUG] Calling Gemini API URL:', apiUrl.replace(geminiApiKey, '***'));
    
    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ 
          parts: [{ text: prompt }] 
        }] 
      }),
    });

    console.log('[DEBUG] Gemini API Response Status:', apiResponse.status);
    
    if (!apiResponse.ok) {
      const errorData = await apiResponse.text();
      console.error(`[ERROR] Gemini API Error Status: ${apiResponse.status}`);
      console.error(`[ERROR] Gemini API Error Response: ${errorData}`);
      throw new Error(`AI APIがエラー: ${apiResponse.status}`);
    }
    
    const responseData = await apiResponse.json();
    const summary = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!summary) throw new Error('AIからの応答が空です。');

    res.status(200).json({ summary: summary.trim() });

  } catch (error: any) {
    console.error('An error occurred in summarize-article handler:', error);
    res.status(500).json({ error: error.message || 'サーバーでエラーが発生しました。' });
  }
}