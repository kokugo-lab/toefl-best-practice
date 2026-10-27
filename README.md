# TOEFL / IELTS Best Practice

新形式TOEFL（2026年1月〜）と IELTS Academic の4技能練習アプリ。
HTML単一ファイル＋サーバー関数（LLM呼び出し）。Cloudflare Pages と Netlify のどちらでも動く。

## 構成

```
index.html                    画面すべて（CSS・JS込み）
lib/core.mjs                  LLM 呼び出しの本体（プロンプト・Gemini/Claude 呼び出し。APIキーはサーバー側のみ）
functions/api/claude.js       Cloudflare Pages Functions 用の入口（/api/claude）
netlify/functions/claude.mjs  Netlify Functions 用の入口
netlify.toml                  Netlify の publish / functions 設定、/api/claude へのリダイレクト
```

## Cloudflare Pages での設定（無料）

1. https://dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git → このリポジトリ
2. Production branch: `main`／Framework preset: None／Build command: 空欄／Build output directory: `/`
3. Settings → Variables and Secrets に `GEMINI_API_KEY` を Secret で追加し、Deployments から Retry deployment
   （任意で `GEMINI_MODEL`、`LLM_PROVIDER` なども同じ場所に追加）

`functions/` フォルダは自動で関数として扱われ、`/api/claude` で呼ばれる。待ち時間の打ち切りがないので、生成は最長約50秒まで待つ。

## Netlify での設定

1. Add new site → Import an existing project → GitHub → このリポジトリ
2. Build command: 空欄／Publish directory: `.`／Functions directory: `netlify/functions`
3. Site configuration → Environment variables に `GEMINI_API_KEY` を追加し、Redeploy

Netlify の関数は約30秒で打ち切られるので、生成は約25秒に収める。

### プロバイダの切り替え

`LLM_PROVIDER` で変更する。既定は `gemini`。

| LLM_PROVIDER | 必要な環境変数 | モデル指定 |
|---|---|---|
| `gemini`（既定） | `GEMINI_API_KEY` | `GEMINI_MODEL`（既定 `gemini-3.8-flash`） |
| `anthropic` | `ANTHROPIC_API_KEY` | `CLAUDE_MODEL`（既定 `claude-sonnet-5-5`） |

Gemini は無料枠で運用できる。キーは https://aistudio.google.com/apikey で発行する。画面側のコードはプロバイダに依存しない。

## 注意

出題はすべて新形式TOEFL・IELTS を模した練習問題であり、公式問題ではない。
表示されるバンドは目安で、公式採点とは一致しない。
Speaking の評価は文字起こしに基づくため、発音・抑揚・間は評価対象外。
