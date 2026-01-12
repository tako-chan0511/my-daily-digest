# AI ニュースダイジェスト(Vue3) - Gemini API 統合トラブルシューティングレポート

**報告日：** 2026年1月12日  
**対象システム：** my-daily-digest (Vercel + Vue3 + Gemini API)  
**ステータス：** ✅ **解決完了**

---

## 📋 問題の概要

Vue3 で構築したニュースダイジェスト・アプリケーションの Gemini API 統合に失敗し、記事要約機能が動作していませんでした。

**初期エラー：**
```
Failed to execute 'json' on 'Response': Unexpected end of JSON input
AI APIがエラー: 404
```

---

## 🔍 トラブルシューティングの経過

### **第1段階：問題の初期分析**

**症状：**
- フロントエンド（Vercel デプロイ）で 500 Internal Server Error
- ネットワークコンソールに詳細なエラーレスポンスが表示されない

**対応：**
- エラーハンドリングコードを改善
- サーバーログに詳細情報を出力するデバッグログを追加

**結果：**
- エラーの詳細情報は取得できたが、根本原因は特定されず

---

### **第2段階：API エンドポイント URL の修正（失敗）**

**問題発見：**
- 初期コード：`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent`
- **存在しないエンドポイント** を使用していた（`v1beta` + `gemini-1.5-flash-latest`）

**対応：**
1. `v1p1` バージョンに変更 ❌ **失敗**
2. `v1beta` に戻す ❌ **失敗**
3. `v1` バージョンに変更 ❌ **失敗**

**理由：** モデル名そのものが存在していなかった

---

### **第3段階：ローカル開発環境の構築（重要な転機）**

**ターニングポイント：** Vercel でのデバッグより、ローカル開発環境（`vercel dev`）を使用

```bash
vercel dev
```

**メリット：**
- サーバーログをリアルタイムで確認可能
- API レスポンスの詳細なエラーメッセージが即座に表示される
- 修正 → テスト のサイクルが大幅に短縮

**出力されたエラーメッセージ：**
```
[ERROR] Gemini API Error Response: {
  "error": {
    "code": 404,
    "message": "models/gemini-1.5-flash is not found for API version v1beta, 
               or is not supported for generateContent. Call ListModels to see 
               the list of available models and their supported methods.",
    "status": "NOT_FOUND"
  }
}
```

このメッセージから、利用可能なモデルを確認する必要があることが明確になりました。

---

### **第4段階：利用可能なモデルの確認（解決策）**

**デバッグコード追加：**
```typescript
const listModelsUrl = `https://generativelanguage.googleapis.com/v1/models?key=${geminiApiKey}`;
const listResponse = await fetch(listModelsUrl);
const listData = await listResponse.json();
console.log('[DEBUG] Available models:', JSON.stringify(listData.models?.map((m: any) => m.name) || []));
```

**取得されたモデル一覧：**
```
"models/gemini-2.5-flash"          ✅ 推奨
"models/gemini-2.5-pro"
"models/gemini-2.0-flash"
"models/gemini-2.0-flash-001"
"models/gemini-2.0-flash-lite-001"
"models/gemini-2.0-flash-lite"
"models/gemini-2.5-flash-lite"
"models/embedding-001"
"models/text-embedding-004"
```

**最終修正：**
```typescript
// 修正前
const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;

// 修正後
const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
```

---

## ✅ 解決内容

### **修正ファイル：**

1. **[api/summarize-article.ts](api/summarize-article.ts)**
   - Gemini API エンドポイント：`v1beta` → `v1`
   - モデル名：`gemini-1.5-flash` → `gemini-2.5-flash`
   - エラーハンドリング強化

2. **[api/answer-question.ts](api/answer-question.ts)**
   - 同じ修正を適用

### **修正内容一覧：**

| 項目 | 修正前 | 修正後 | 理由 |
|------|--------|--------|------|
| **API バージョン** | `v1beta` | `v1` | v1 が最新で安定版 |
| **モデル名** | `gemini-1.5-flash` | `gemini-2.5-flash` | 利用可能なモデルの確認結果 |
| **エラーログ** | 簡潔 | 詳細（URL、ステータス、レスポンス） | デバッグ効率向上 |
| **デバッグ情報** | なし | ListModels API で確認 | 将来の問題解決に有効 |

---

## 🎯 根本原因分析

### **何が問題だったか：**

1. **API 仕様の変更への対応遅れ**
   - 古いサンプルコード（`gemini-1.5-flash-latest`）を参照していた
   - 実際の利用可能なモデルの確認を怠った

2. **開発環境の最適化不足**
   - Vercel 上でのデバッグだけに頼っていた
   - ローカル開発環境（`vercel dev`）の活用が遅かった

3. **API キーの有効性確認**
   - API キーは正常だったが、対応するモデルが存在しなかった

---

## 📚 学んだこと・ベストプラクティス

### **今後の改善点：**

1. **ローカル開発環境を優先**
   - 本番環境でのデバッグより、ローカル開発環境で詳細ログを確認すべき
   - `vercel dev` を最初から使用すれば、トラブルシューティング時間を大幅短縮可能

2. **外部 API の仕様確認**
   - API ドキュメントの最新版を確認
   - 利用可能なモデル・バージョンを事前に確認

3. **エラーハンドリングの強化**
   - API エラーレスポンスをコンソールに出力
   - スタックトレースの詳細記録

4. **デバッグ機能の実装**
   - ListModels API を使用した利用可能なモデルの確認機能
   - API リクエスト URL の詳細ログ出力

---

## 🚀 デプロイ状況

```bash
# コミット履歴
git commit -m "Add debug logs for API troubleshooting"
git commit -m "Fix Gemini API endpoint from v1p1 to v1beta and add detailed error logging"
git commit -m "Fix Gemini API version from v1beta to v1"
git commit -m "Update Gemini model from gemini-1.5-flash to gemini-2.5-flash"
git push origin main
```

**本番環境：** ✅ Vercel に自動デプロイ完了  
**ローカルテスト：** ✅ すべての機能が正常に動作確認

---

## 📊 トラブルシューティング統計

| 指標 | 値 |
|------|-----|
| **トラブルシューティング期間** | 約 4～5 時間 |
| **修正ファイル数** | 2 ファイル |
| **修正の段階数** | 4 段階 |
| **ターニングポイント** | ローカル開発環境（`vercel dev`）の活用 |
| **最終成功** | ✅ ローカルおよび本番環境で動作確認完了 |

---

## 📝 結論

**問題：** 利用できないモデル名を使用していた  
**解決策：** ListModels API で確認し、`gemini-2.5-flash` に変更  
**所要時間短縮のコツ：** ローカル開発環境を早期に活用すること

アプリケーションは現在、正常に動作しており、ユーザーはニュース検索、記事要約、AI との対話機能をすべて使用できるようになりました。

---

**報告者：** GitHub Copilot  
**確認日：** 2026年1月12日
