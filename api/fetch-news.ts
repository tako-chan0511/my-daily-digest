import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "POST method required." });
  }

  // フロントからAPIキーを受け取るのをやめる
  const { keyword } = req.body;
  // サーバーの環境変数から直接APIキーを読み込む
  const gnewsApiKey = process.env.GNEWS_API_KEY;

  if (!keyword || typeof keyword !== 'string') {
    return res.status(400).json({ error: '検索キーワードが必要です。' });
  }
  if (!gnewsApiKey) {
    // エラーメッセージを分かりやすく変更
    return res.status(500).json({ error: 'GNews APIキーがサーバーに設定されていません。' });
  }

  try {
    const params = new URLSearchParams({
      q: keyword,
      lang: 'ja',
      country: 'jp',
      max: '10',
      apikey: gnewsApiKey, // サーバーのキーを使用
    });

    const gnewsUrl = `https://gnews.io/api/v4/search?${params.toString()}`;
    const response = await fetch(gnewsUrl);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`GNews API request failed: ${response.status} ${errorData?.errors?.join(', ') || 'Unknown error'}`);
    }

    const data = await response.json();
    res.status(200).json(data.articles || []);

  } catch (error: any) {
    console.error('An error occurred in fetch-news handler:', error);
    res.status(500).json({ error: error.message || 'サーバーでエラーが発生しました。' });
  }
}