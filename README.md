# TOEFL Best Practice

新形式TOEFL（2026年1月〜）の4技能練習＋模試アプリ。
HTML単一ファイル＋Netlify Functions（Claude API呼び出し）。

## 構成

```
index.html                  画面すべて（CSS・JS込み）
netlify/functions/claude.js Claude API 呼び出し（APIキーはサーバー側のみ）
netlify.toml                publish / functions の設定、/api/claude へのリダイレクト
```

## Netlify での設定

1. Add new site → Import an existing project → GitHub → このリポジトリ
2. Build command: 空欄／Publish directory: `.`／Functions directory: `netlify/functions`
3. Site configuration → Environment variables に以下を追加し、Redeploy
   - `GEMINI_API_KEY`（必須／既定のプロバイダ）
   - `GEMINI_MODEL`（任意／既定は `gemini-3.8-flash`）

APIキーはブラウザに一切渡らず、Netlify Functions の中だけで使われる。

### プロバイダの切り替え

`LLM_PROVIDER` で変更する。既定は `gemini`。

| LLM_PROVIDER | 必要な環境変数 | モデル指定 |
|---|---|---|
| `gemini`（既定） | `GEMINI_API_KEY` | `GEMINI_MODEL`（既定 `gemini-3.8-flash`） |
| `anthropic` | `ANTHROPIC_API_KEY` | `CLAUDE_MODEL`（既定 `claude-sonnet-5-5`） |

Gemini は無料枠（1日あたり千数百リクエスト）で運用できる。キーは
https://aistudio.google.com/apikey で発行する。画面側のコードはプロバイダに依存しない。

## 実装状況

- [x] 第1段階：ホーム／記録・ノート／Netlify Function／Speaking (Take an Interview)／Writing (Write an Email)
- [x] 第2段階：Reading（Complete the Words／Daily Life／Academic Passage）、Listening（Choose a Response／Conversation／Announcement／Academic Talk）。いずれも2段階アダプティブ
- [ ] 第3段階：Listen and Repeat、Build a Sentence、Academic Discussion
- [ ] 第4段階：模試モード（一括生成・制限時間・成績画面）

## 注意

出題はすべて新形式を模した練習問題であり、公式問題ではない。
表示されるバンドは目安で、公式採点とは一致しない。
Speaking の評価は文字起こしに基づくため、発音・抑揚・間は評価対象外。
