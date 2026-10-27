# TOEFL Best Practice — 開発メモ（Claude向け）

新形式TOEFL（2026年1月〜）の4技能練習＋模試Webアプリ。利用者は本人（日本人学習者、目標CEFR B2／バンド4.0〜4.5、本番 2026-11-29）。
元の仕様書は `docs/spec.md`。画面の説明文は日本語、出題と回答は英語。

## 構成
- `public/index.html` … 画面すべて（CSS・JS込みの単一ファイル）。データは localStorage キー `toefl_bp_v1`（必ず try/catch）。
- `lib/core.mjs` … LLM呼び出しの本体（プロンプト `TASKS`、Gemini/Claude 呼び出し、`handle()`）。`action` で処理を分岐。
  APIキーはサーバー側の環境変数のみ（`env` 引数で受け取る。`process.env` は直接使わない）。
- `worker/index.mjs`＋`wrangler.jsonc` … Cloudflare Workers の入口（`public/` を配信し `/api/claude` を処理、待ち時間50秒）。
- `functions/api/claude.js` … Cloudflare Pages Functions を使う場合の入口（同じく50秒）。
- `netlify/functions/claude.mjs` … Netlify Functions の入口（待ち時間25秒）。`netlify.toml` で `/api/claude` から転送。
- 公開先：Cloudflare Workers（メイン。main に push すると Workers Builds が `npx wrangler deploy` で自動デプロイ）。Netlify（https://toefl-best-practice.netlify.app）は
  無料クレジットを使い切ると公開が止まるため予備。main への push はまとめて回数を減らす。

## LLM
- 既定は Google Gemini 無料枠（`LLM_PROVIDER` 未設定＝gemini、`GEMINI_API_KEY` はNetlifyに設定済み）。
  主モデル `gemini-3.8-flash`、遅い・混雑時は `gemini-3.5-flash-lite` に切替。全体を約25秒に収める時間管理あり
  （Netlify関数は約30秒で打ち切られるので25秒、Cloudflare は50秒）。端末側 `api()` は時間切れ・混雑で1回自動リトライ。
- 生成は課題ごとに分けて並列に呼ぶ（1回の出力を小さく保つ）。出力は必ずJSON。
- 費用は完全無料で運用する方針。有料APIを既定にしないこと。

## 実装状況（仕様書「作る順序」）
- [x] 1. 共通部分（ホーム・記録/ノート・関数）、Speaking: Take an Interview、Writing: Write an Email
- [x] 2. Reading（Complete the Words／Read in Daily Life／Read an Academic Passage）、
        Listening（Choose a Response／Conversation／Announcement／Academic Talk）。どちらも2段階アダプティブ
- [x] 3. Listen and Repeat（Speaking・7文、端末側で語の再現率を採点）、Build a Sentence（10問、端末側で採点）、
        Write for an Academic Discussion（Writing・`eval_discussion` で添削）
- [x] 学習効果の追加（2026-10）：ノートの間隔反復（SRS）、苦手タグを生成に渡す（`focus`）、Writing の書き直しループ、
        Listening の文ごとの聞き直し・書き取り・くり返し、Interview 本番形式（4問×45秒）と答え直し、1問ごとの時間記録、
        Complete the Words 3分ドリル、学習カレンダー、バックアップ（JSON書き出し・読み込み）
- [x] IELTS Academic モード（初回に TOEFL／IELTS を選ぶ。右上の「試験」で切替）：Listening 4パート、Reading 3パッセージ、
        Writing Task 1（図表をSVGで描画）・Task 2、Speaking Part 1〜3。バンドは0〜9
- [ ] 4. 模試モード（全セクション一括生成→localStorage保存、本番順・制限時間・戻れない、成績画面、過去結果のグラフ）

## 実装上の約束
- Reading/Listening の進行は `public/index.html` の「Reading / Listening 共通エンジン」（`genModule`, `renderRL`, `checkStage` など）。
  選択肢は端末側でシャッフル（`normQ`）。誤答理由 `why_wrong_ja`・誤答タイプ `trap` は選択肢と同じ並び。
- 第1段階の正答率 ≥70% → 難しめ、<40% → やさしめ。バンドは正答率と第2段階の難易度から算出（目安）。
- 間違い・言い換え・未知語は `addNotes()` でノートに自動保存。
- Writing・Speaking は画面上部のタブで課題を切り替え（`segSwitch`）。Email と Academic Discussion は `setupWriter()` を共用し、
  下書きは `DB.draft.email` / `DB.draft.disc`。Build・Repeat の進行状態は `DB.cur.build` / `DB.cur.repeat`。
- 記録 `DB.records` には `task`（build / email / disc / repeat / interview）を付ける。古い記録は `taskOf()` で補う。
- 試験は `DB.settings.exam`（toefl / ielts）。`go()` が IELTS のときは `v-ireading` などへ振り替える。記録には `exam` を付け
  （古い記録は toefl）、`recs()` で今の試験の分だけ取り出す。ノート・SRS は共通。記録は必ず `addRecord()` で追加（学習ログも付く）。
- 苦手の集計は `statAdd()`／`weakTags()`（`DB.stats`）。生成時に `focus` として渡すと、関数側の `focus(i)` がプロンプトに足す。
- Speaking は共通エンジン（`spkInit`/`spkRender`、状態は `DB.cur.iv`／`DB.cur.is`）。録音と文字起こしは `recStart`/`recStop`。
- IELTS Reading/Listening は `iStart`/`iRender`/`iCheck`（`DB.cur.ireading`／`DB.cur.ilistening`）。正答数を40問換算してバンドの目安を出す。
- 書き直し・答え直しは記録（バンドの推移）に入れない。`previous` を渡すと関数側の `rw(i)` が `rewrite_ja` を返させる。
- 音声は SpeechSynthesis（男女2声、同じ声しかなければ pitch で区別）、文を分けてキューに積む。
- 「公式問題ではない」「バンドは目安」「公式と細部が異なる場合あり」の表示を消さない。
- Speaking評価では発音・抑揚・間を評価しないと明記する。
- ブラウザのダイアログ（alert/confirm）は新たに増やさない。
- 変更後は `node --check lib/core.mjs functions/api/claude.js netlify/functions/claude.mjs worker/index.mjs` と、
  public/index.html の script が構文として通ることを確認してから push。

## ユーザーへの返答
日本語で。調査結果・選択肢の提示で終え、「次のステップ」「懸念」といった助言セクションは付けない。
