<template>
  <div id="app">
    <div class="top-bar">
      <h1>AIニュースダイジェスト(Vue3)</h1>
      <div class="search-box">
        <input
          v-model="keyword"
          @keyup.enter="fetchNews"
          placeholder="検索キーワード (例: 半導体)"
        />
        <button @click="fetchNews" :disabled="loading.news">
          <span v-if="!loading.news">ニュースを取得</span>
          <span v-else>取得中...</span>
        </button>
      </div>
    </div>

    <div class="main-content">
      <div class="pane article-list-pane">
        <h2 class="pane-title">検索結果</h2>
        <div v-if="loading.news" class="loading-spinner"></div>
        <div v-if="error.news" class="error-message">{{ error.news }}</div>
        <ul v-if="state.articles.length > 0">
          <li
            v-for="(article, index) in state.articles"
            :key="index"
            @click="selectArticle(article)"
            :class="{ selected: state.selectedArticle?.url === article.url }"
          >
            <h3>{{ article.title }}</h3>
            <div class="meta-info">
              <span class="source-name">{{ article.source.name }}</span>
              <span class="date">{{ formatDate(article.publishedAt) }}</span>
            </div>
            <a
              class="source-url"
              :href="article.source.url"
              target="_blank"
              rel="noopener noreferrer"
              @click.stop
            >
              {{ article.source.url }}
            </a>
          </li>
        </ul>
        <div
          v-if="
            !loading.news &&
            state.articles.length === 0 &&
            state.lastSearchedKeyword
          "
          class="placeholder"
        >
          「{{
            state.lastSearchedKeyword
          }}」に関するニュースは見つかりませんでした。
        </div>
      </div>

      <div class="pane article-content-pane">
        <h2 class="pane-title">AI要約</h2>
        <div
          v-if="loading.content || loading.summary"
          class="loading-spinner"
        ></div>
        <div v-if="error.summary" class="error-message">
          {{ error.summary }}
        </div>

        <div v-if="state.summaryResult" class="ai-section">
          <div
            class="summary-result markdown-body"
            v-html="marked(state.summaryResult)"
          ></div>
        </div>

        <div
          v-if="!state.selectedArticle && !loading.content && !loading.summary"
          class="placeholder"
        >
          ← 記事を選択すると、ここにAI要約が表示されます
        </div>
      </div>

      <div class="pane ai-assistant-pane">
        <h2 class="pane-title">AIと対話</h2>
        <div v-if="loading.answer" class="loading-spinner"></div>

        <div v-if="state.selectedArticle" class="ai-section follow-up-section">
          <h3>記事への質問</h3>
          <div class="question-form">
            <textarea
              v-model="followUpQuestion"
              placeholder="記事の内容について質問を入力..."
              rows="3"
            ></textarea>
            <button
              @click="askQuestion"
              :disabled="loading.answer || !followUpQuestion"
            >
              質問する
            </button>
          </div>
          <div v-if="error.answer" class="error-message">
            {{ error.answer }}
          </div>
          <div v-if="state.qaHistory.length > 0" class="qa-history">
            <h4>対話履歴</h4>
            <div
              v-for="(item, index) in state.qaHistory"
              :key="index"
              class="qa-item"
            >
              <p class="question">{{ item.question }}</p>
              <p class="answer markdown-body" v-html="marked(item.answer)"></p>
            </div>
          </div>
        </div>

        <div
          v-if="!state.selectedArticle && !loading.answer"
          class="placeholder"
        >
          ← 記事を選択すると、ここからAIと対話できます
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// VueのonMountedとwatchをインポート
import { ref, reactive, onMounted, watch } from "vue";
import { marked } from "marked";

// --- 状態管理オブジェクト ---
// 永続化したいデータを一つのreactiveオブジェクトにまとめる
const state = reactive({
  lastSearchedKeyword: "半導体", // 初期キーワード
  articles: [] as any[],
  selectedArticle: null as any | null,
  selectedArticleContent: "", // Q&Aのために記事本文は保持する
  summaryResult: "",
  qaHistory: [] as { question: string; answer: string }[],
});

// --- UI操作など、永続化しないデータ ---
const keyword = ref(state.lastSearchedKeyword); // 検索ボックスの入力値
const loading = reactive({
  news: false,
  content: false,
  summary: false,
  answer: false,
});
const error = reactive({ news: "", content: "", summary: "", answer: "" });
const followUpQuestion = ref("");

// --- 状態の保存と復元 ---

// 状態をlocalStorageに保存する関数
const saveState = () => {
  try {
    const stateToSave = JSON.stringify(state);
    localStorage.setItem("aiNewsDigestState", stateToSave);
  } catch (e) {
    console.error("Failed to save state:", e);
  }
};

// localStorageから状態を復元する関数
const loadState = () => {
  try {
    const savedState = localStorage.getItem("aiNewsDigestState");
    if (savedState) {
      const parsedState = JSON.parse(savedState);
      // 保存されたデータでstateを更新
      Object.assign(state, parsedState);
      // 検索ボックスのキーワードも復元した値に合わせる
      keyword.value = state.lastSearchedKeyword;
    }
  } catch (e) {
    console.error("Failed to load state:", e);
    localStorage.removeItem("aiNewsDigestState"); // エラー時はクリア
  }
};

// アプリケーション起動時に一度だけ状態を復元
onMounted(() => {
  loadState();
});

// stateオブジェクトが変更されたら、自動でsaveStateを実行
// { deep: true } オプションでオブジェクトの深い階層の変更も検知
watch(state, saveState, { deep: true });

// --- API通信などの関数 ---
// (内部のロジックを全て新しいstateオブジェクトを参照するように変更)

const fetchNews = async () => {
  if (!keyword.value) {
    error.news = "キーワードを入力してください。";
    return;
  }
  loading.news = true;
  error.news = "";

  // 状態をリセット
  state.articles = [];
  state.selectedArticle = null;
  state.selectedArticleContent = "";
  state.summaryResult = "";
  state.qaHistory = [];
  followUpQuestion.value = "";
  state.lastSearchedKeyword = keyword.value;

   try {
    // ★★★ VITE_GNEWS_API_KEY を読み込む行を削除 ★★★

    const response = await fetch("/api/fetch-news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // ★★★ gnewsApiKey を送信する部分を削除 ★★★
        keyword: state.lastSearchedKeyword,
      }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "ニュースの取得に失敗しました。");
    state.articles = data;
  } catch (e: any) {
    error.news = e.message;
  } finally {
    loading.news = false;
  }
};

const selectArticle = async (article: any) => {
  if (state.selectedArticle?.url === article.url) return;
  state.selectedArticle = article;

  // 選択時にサマリーとQ&A履歴をリセット
  state.selectedArticleContent = "";
  state.summaryResult = "";
  state.qaHistory = [];
  followUpQuestion.value = "";
  error.content = "";
  error.summary = "";
  error.answer = "";

  fetchArticleContent(article.url);
};

const fetchArticleContent = async (url: string) => {
  loading.content = true;
  loading.summary = true;
  try {
    const response = await fetch("/api/fetch-article-content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleUrl: url }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    state.selectedArticleContent = data.articleText;
    summarizeText(data.articleText);
  } catch (e: any) {
    error.content = e.message;
    error.summary = e.message;
  } finally {
    loading.content = false;
  }
};

const summarizeText = async (text: string) => {
  try {
    // ★★★ VITE_GEMINI_API_KEY を読み込む行を削除 ★★★

    const response = await fetch("/api/summarize-article", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        articleText: text, 
        // ★★★ geminiApiKey を送信する部分を削除 ★★★
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    state.summaryResult = data.summary;
  } catch (e: any) {
    error.summary = e.message;
  } finally {
    loading.summary = false;
  }
};

const askQuestion = async () => {
  if (!followUpQuestion.value || !state.selectedArticleContent) return;

  loading.answer = true;
  error.answer = "";
  const currentQuestion = followUpQuestion.value;
  followUpQuestion.value = "";

  try {
    // ★★★ VITE_GEMINI_API_KEY を読み込む行を削除 ★★★

    const response = await fetch("/api/answer-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        articleText: state.selectedArticleContent,
        question: currentQuestion,
        // ★★★ geminiApiKey を送信する部分を削除 ★★★
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    state.qaHistory.unshift({ question: currentQuestion, answer: data.answer });
  } catch (e: any) {
    error.answer = e.message;
  } finally {
    loading.answer = false;
  }
};
// ★★追加: 日付をフォーマットする関数
const formatDate = (isoString: string): string => {
  if (!isoString) return "";
  const date = new Date(isoString);
  const year = date.getFullYear();
  // getMonth()は0から始まるため+1する。padStartで0埋めする
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${year}年${month}月${day}日 ${hours}:${minutes}`;
};
</script>

<style>
:root {
  --border-color: #e0e0e0;
  --background-color: #f4f5f7;
  --pane-background: #ffffff;
  --primary-color: #0d6efd;
  --text-color: #212529;
  --sub-text-color: #6c757d;
  --selected-bg-color: #e9ecef;
}
html,
body {
  height: 100%;
  margin: 0;
  font-family: "Hiragino Kaku Gothic ProN", "ヒラギノ角ゴ ProN W3", Meiryo,
    メイリオ, Osaka, "MS PGothic", arial, helvetica, sans-serif;
  background-color: var(--background-color);
  color: var(--text-color);
}
#app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.top-bar {
  display: flex;
  align-items: center;
  padding: 1rem 1.5rem;
  background-color: var(--pane-background);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  z-index: 10;
  flex-shrink: 0;
}
.top-bar h1 {
  font-size: 1.5rem;
  margin: 0;
  color: #333;
}
.search-box {
  display: flex;
  gap: 0.5rem;
  margin-left: auto;
  width: 450px;
}
.search-box input {
  flex-grow: 1;
  padding: 0.75rem 1rem;
  font-size: 1rem;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  transition: all 0.2s ease;
}
.search-box input:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.25);
}

.search-box button {
  padding: 0.75rem 1.5rem;
  font-size: 1rem;
  font-weight: 500;
  color: white;
  background-color: var(--primary-color);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}
.search-box button:hover:not(:disabled) {
  background-color: #0b5ed7;
}
.search-box button:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.main-content {
  display: flex;
  flex-grow: 1;
  overflow: hidden;
  padding: 1rem;
  gap: 1rem;
}
.pane {
  overflow-y: auto;
  background-color: var(--pane-background);
  border: none;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
}

.pane-title {
  font-size: 1.1rem;
  font-weight: 600;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--border-color);
  margin: 0;
  background-color: #fcfcfc;
  position: sticky;
  top: 0;
  z-index: 5;
  border-top-left-radius: 12px;
  border-top-right-radius: 12px;
}

/* ★★変更点: パネルの幅をflex比率で調整 */
.article-list-pane {
  flex: 1; /* 比率1 */
  min-width: 300px; /* 最小幅 */
}
.article-content-pane {
  flex: 1.5; /* 比率1.5 */
  min-width: 350px; /* 最小幅 */
}
.ai-assistant-pane {
  flex: 1.5; /* 比率1.5 */
  min-width: 350px; /* 最小幅 */
}

.article-list-pane ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.article-list-pane li {
  padding: 1rem 1.5rem;
  cursor: pointer;
  border-bottom: 1px solid var(--border-color);
  transition: background-color 0.2s ease;
}
.article-list-pane li:last-child {
  border-bottom: none;
}
.article-list-pane li:hover {
  background-color: #f8f9fa;
}
.article-list-pane li.selected {
  background-color: var(--selected-bg-color);
  border-left: 4px solid var(--primary-color);
  padding-left: calc(1.5rem - 4px);
}
.article-list-pane h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-color);
}
/* ★★追加: 日付とソース名を囲むコンテナ */
.meta-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;
  color: var(--sub-text-color);
  margin: 0.5rem 0 0.25rem;
}

.source-name {
  font-weight: 500;
}

.date {
  /* 右寄せにする */
  margin-left: auto;
  padding-left: 1em;
}
.source {
  font-size: 0.8rem;
  color: var(--sub-text-color);
  margin: 0;
}
.source a {
  color: var(--sub-text-color);
  text-decoration: none;
}
.source a:hover {
  text-decoration: underline;
}
/* ★★修正: URLのスタイルを調整 */
.source-url {
  font-size: 0.8rem;
  color: var(--sub-text-color);
  text-decoration: none;
  display: block; /* URLが長い場合に折り返すように */
  word-break: break-all;
}
.source-url:hover {
  text-decoration: underline;
}

.ai-section {
  padding: 1.5rem;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
}

.follow-up-section > h3 {
  margin-top: 0;
  margin-bottom: 1rem;
  font-size: 1rem;
  font-weight: 600;
  border-bottom: 1px solid #eee;
  padding-bottom: 0.75rem;
}

.question-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.question-form textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 0.75rem;
  font-size: 0.95rem;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  resize: vertical;
  transition: all 0.2s ease;
}
.question-form textarea:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.25);
}
.question-form button {
  align-self: flex-end;
  padding: 0.5rem 1rem;
  font-size: 0.9rem;
  color: white;
  background-color: var(--primary-color);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}
.question-form button:hover:not(:disabled) {
  background-color: #0b5ed7;
}

.qa-history {
  margin-top: 1.5rem;
  padding: 0 0.5rem;
  flex-grow: 1;
  overflow-y: auto;
}
.qa-history h4 {
  margin-top: 0;
  font-size: 0.9rem;
  color: var(--sub-text-color);
}
.qa-item {
  margin-bottom: 1.5rem;
  border-bottom: none;
  display: flex;
  flex-direction: column;
}
.qa-item .question {
  padding: 0.75rem 1rem;
  border-radius: 12px;
  line-height: 1.6;
  max-width: 90%;
  background-color: var(--selected-bg-color);
  align-self: flex-end;
  border-bottom-right-radius: 0;
  font-weight: 600;
}
.qa-item .answer {
  padding: 0.75rem 1rem;
  border-radius: 12px;
  line-height: 1.6;
  max-width: 90%;
  background-color: #f1f3f4;
  align-self: flex-start;
  border-bottom-left-radius: 0;
  white-space: pre-wrap;
  margin-top: 0.5rem;
}
.qa-item p {
  margin: 0;
}

.placeholder {
  flex-grow: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  color: var(--sub-text-color);
  padding: 1.5rem;
  text-align: center;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 2rem auto;
}
@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.error-message {
  color: #b91c1c;
  background-color: #fef2f2;
  border: 1px solid #fca5a5;
  padding: 1rem;
  border-radius: 8px;
  margin: 1rem;
}

/* ★★追加: Markdown用のスタイル */
.markdown-body {
  line-height: 1.7;
}
.markdown-body h1,
.markdown-body h2,
.markdown-body h3 {
  margin-top: 1.5rem;
  margin-bottom: 1rem;
  line-height: 1.3;
  font-weight: 600;
}
.markdown-body h3 {
  font-size: 1.2rem;
  border-bottom: 1px solid #eee;
  padding-bottom: 0.3em;
}
.markdown-body p {
  margin-top: 0;
  margin-bottom: 1rem;
}
.markdown-body ul,
.markdown-body ol {
  margin-bottom: 1rem;
  padding-left: 2rem;
}
.markdown-body li > p {
  margin-bottom: 0.25rem;
}
.markdown-body strong {
  color: var(--primary-color);
}
.markdown-body pre,
.markdown-body code {
  font-family: monospace;
  background-color: #f1f3f4;
  padding: 0.2em 0.4em;
  border-radius: 4px;
}
</style>
