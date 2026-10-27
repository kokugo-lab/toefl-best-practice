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
        Complete the Words 練習（3分）、学習カレンダー、バックアップ（JSON書き出し・読み込み）
- [x] IELTS Academic モード（初回に TOEFL／IELTS を選ぶ。右上の「試験」で切替）：Listening 4パート、Reading 3パッセージ、
        Writing Task 1（図表をSVGで描画）・Task 2、Speaking Part 1〜3。バンドは0〜9
- [x] 適性診断（約8〜10分、`v-fit`、`fitStart`/`fitRender`/`fitScore`、生成は `gen_fit_a`・`gen_fit_b`）：長文TFNG・読む速さ・
        メモ完成（IELTS向き）と Complete the Words・Build a Sentence・応答選択（TOEFL向き）＋アンケートで向いている試験の目安を出す
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
- 生成（`gen_*`）は Gemini の思考レベル "minimal"、採点・添削は "low"（`handle()` 内。拒否されたら一段上げて再試行）。
- 先回りの生成：課題の開始は必ず `stockGet(key)` を通す（`stockDef(key, fn)` で生成関数を登録）。一度使った課題は次の1セットを
  裏で作って `DB.stock` に置く（ユーザーの通信中は待つ・1つずつ・14日で期限切れ）。準備済みのボタンには「・準備済み」が付く。
- 生成・評価の完了は `arrived(el, label, goto)`、失敗は `fail()` で、別の画面にいるときは `toast()` でお知らせする。
- 答え合わせ後の解説：Complete the Words は `cwExplain()`（`explain_ctest`、答え合わせ後に自動）で1語ずつの意味・手がかりと全文訳。
  ほかの設問は「詳しい解説」ボタンで `moreFetch()`（`explain_q`、結果は設問の `more` に保存）。選択肢は画面の並び順で送る。
- 全文訳と根拠：解答がそろった本文ごとに `xpFetch(key)`（`explain_part`）。本文を文に分けて送り（読解は `readSegs`、音声は `splitSegs`）、
  各文の訳・設問ごとの根拠の文番号・考え方を受け取って本文側の `xp` に保存。根拠の文は赤字＋「Q番号」、各設問に「考え方」。
- 起動時の描画（`bRender` など）は、すべての関数・定数を定義し終えた「起動」の部分でだけ行う（途中で呼ぶと const が未定義で止まる）。
- 「やめる」：進行中の画面には `quitBtnHTML(key)`（二度押しで確定）。`quitSession(key)` が音声・録音・時計を止めて進行を破棄（記録に入れない）。
  再生完了などの遅れて届く処理は、状態が消えていたら何もしない（`rerenderPart`・`iUpdCtl` などで確認）。
- コツと単語（TOEFL のみ）：中身は `GUIDE`（単元ごとの形式・コツ・落とし穴・単語[英,意味,例文]）に固定で書く。`data-guide="単元"` の
  ボタンで下からシートが開く（`guideOpen`）。単語は `addNotes("word")` でノート・SRS に入る。
- ノートから外す：`removeNotes(pred)`（お知らせは出さない）。ノート一覧・今日の復習・コツと単語から使う。
- 課題ごとの目安バンド：`partBand(正答率, 難しさ)`＋`bandPill("Reading", b)`（「（目安）」は付けない）。TOEFL の各パート・第1段階・3分ドリル、IELTS の各パート（`rawBand`）に表示。
- Complete the Words の全文訳は結果（○/10 語 正解）の上に出す（`cwTransHTML`）。
- 基礎練習（TOEFL のみ）：`wuStart(view)` が `GUIDE` から5問（例文の穴埋め・意味）＋今日のポイントを作り `#wu-<view>` に出す。
  課題を始めたとき自動で出す（`DB.ui.wuOff` で止められる）。状態は保存しない。間違えた語はノートへ。
- 画面の呼び名：🎯 本番（セット）／⏱️ 練習（3分の Complete the Words、Interview の1問）／🌱 基礎（`wuStart`）／💡 コツと単語。開始ボタンは `.stack` で縦に並べる。
- デザイン：やわらかカフェ風＋鳥（見出し・メニュー・ホームの吹き出し `birdSay()`・ぐるぐるは🐦）。正解は「🎉 正解！」、不正解は「💪 おしい！」。
  結果画面には `cheerHTML(正答率, seed)`（鳥のひとこと＋名言 `QUOTES`・約100件）。名言は出典が確かなものだけを入れる（誤って広まった「〜の言葉」は入れない）。
- 新しい版のお知らせ：起動時とアプリに戻ったときに `checkUpdate()` が公開中の画面の script と比べ、違えば「新しい版があります［更新する］」。
- 効果音：`sfx("tap"|"ok"|"ng")`（Web Audio で生成）。ボタンは「ぽん」、採点結果は画面に出た .fb .h を見て鳴らす。録音中（`REC_ACTIVE`）は鳴らさない。設定 `DB.ui.sfxOff`。
- 名言は「言った人」を太字で表示（`quoteWho()` が出典の文字列を人と出典に分ける。ことわざは「ことわざ（国）」）。
- 音声は SpeechSynthesis（男女2声、同じ声しかなければ pitch で区別）、文を分けてキューに積む。
- 「公式問題ではない」「バンドは目安」「公式と細部が異なる場合あり」の表示を消さない。
- Speaking評価では発音・抑揚・間を評価しないと明記する。
- ブラウザのダイアログ（alert/confirm）は新たに増やさない。
- 変更後は `node --check lib/core.mjs functions/api/claude.js netlify/functions/claude.mjs worker/index.mjs` と、
  public/index.html の script が構文として通ることを確認してから push。

## ユーザーへの返答
日本語で。調査結果・選択肢の提示で終え、「次のステップ」「懸念」といった助言セクションは付けない。
