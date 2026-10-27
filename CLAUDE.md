# TOEFL Best Practice — 開発メモ（Claude向け）

新形式TOEFL（2026年1月〜）の4技能練習＋模試Webアプリ。利用者は本人（日本人学習者、目標CEFR B2／バンド4.0〜4.5、本番 2026-11-29）。
元の仕様書は `docs/spec.md`。画面の説明文は日本語、出題と回答は英語。

## 構成
- `index.html` … 画面すべて（CSS・JS込みの単一ファイル）。データは localStorage キー `toefl_bp_v1`（必ず try/catch）。
- `netlify/functions/claude.js` … LLM呼び出し。`action` で処理を分岐。APIキーはサーバー側の環境変数のみ。
- `netlify.toml` … publish `.`、functions `netlify/functions`、`/api/claude` → 関数へリダイレクト。
- 公開URL: https://toefl-best-practice.netlify.app （main に push すると Netlify が自動デプロイ）

## LLM
- 既定は Google Gemini 無料枠（`LLM_PROVIDER` 未設定＝gemini、`GEMINI_API_KEY` はNetlifyに設定済み）。
  主モデル `gemini-3.8-flash`、遅い・混雑時は `gemini-3.5-flash-lite` に切替。全体を約25秒に収める時間管理あり
  （Netlify関数は約30秒で打ち切られる）。端末側 `api()` は時間切れ・混雑で1回自動リトライ。
- 生成は課題ごとに分けて並列に呼ぶ（1回の出力を小さく保つ）。出力は必ずJSON。
- 費用は完全無料で運用する方針。有料APIを既定にしないこと。

## 実装状況（仕様書「作る順序」）
- [x] 1. 共通部分（ホーム・記録/ノート・関数）、Speaking: Take an Interview、Writing: Write an Email
- [x] 2. Reading（Complete the Words／Read in Daily Life／Read an Academic Passage）、
        Listening（Choose a Response／Conversation／Announcement／Academic Talk）。どちらも2段階アダプティブ
- [ ] 3. Listen and Repeat（Speaking）、Build a Sentence、Write for an Academic Discussion（Writing）
- [ ] 4. 模試モード（全セクション一括生成→localStorage保存、本番順・制限時間・戻れない、成績画面、過去結果のグラフ）

## 実装上の約束
- Reading/Listening の進行は `index.html` の「Reading / Listening 共通エンジン」（`genModule`, `renderRL`, `checkStage` など）。
  選択肢は端末側でシャッフル（`normQ`）。誤答理由 `why_wrong_ja`・誤答タイプ `trap` は選択肢と同じ並び。
- 第1段階の正答率 ≥70% → 難しめ、<40% → やさしめ。バンドは正答率と第2段階の難易度から算出（目安）。
- 間違い・言い換え・未知語は `addNotes()` でノートに自動保存。
- 音声は SpeechSynthesis（男女2声、同じ声しかなければ pitch で区別）、文を分けてキューに積む。
- 「公式問題ではない」「バンドは目安」「公式と細部が異なる場合あり」の表示を消さない。
- Speaking評価では発音・抑揚・間を評価しないと明記する。
- ブラウザのダイアログ（alert/confirm）は新たに増やさない。
- 変更後は `node --check netlify/functions/claude.js` と、index.html の script が構文として通ることを確認してから push。

## ユーザーへの返答
日本語で。調査結果・選択肢の提示で終え、「次のステップ」「懸念」といった助言セクションは付けない。
