// LLM proxy for the TOEFL practice app.
// The API key never reaches the browser: it lives in a Netlify environment variable.
//
// Provider is chosen with LLM_PROVIDER ("gemini" by default, or "anthropic").
//   gemini    -> GEMINI_API_KEY   (+ optional GEMINI_MODEL, default gemini-3.8-flash)
//   anthropic -> ANTHROPIC_API_KEY (+ optional CLAUDE_MODEL, default claude-sonnet-5-5)

const PROVIDER = (process.env.LLM_PROVIDER || "gemini").toLowerCase();

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const COMMON = `You are an experienced TOEFL instructor who knows the test format introduced in January 2026
(sections: Reading, Listening, Writing with Build a Sentence / Write an Email / Write for an Academic Discussion,
Speaking with Listen and Repeat / Take an Interview; each section banded 1-6).
The learner is a Japanese adult aiming at CEFR B2 (roughly band 4.0-4.5) for graduate school admission.
Everything you produce is ORIGINAL practice material modelled on the new format, never actual official test content.
All Japanese explanations must be encouraging but concrete and specific - never vague praise.
Always reply with a single valid JSON object and nothing else: no markdown fences, no preamble.`;


const LEVEL = {
  easy: "CEFR B1 level: shorter sentences, high-frequency vocabulary, answers stated fairly explicitly, distractors clearly wrong on careful reading.",
  standard: "CEFR B2 level: typical difficulty of the new-format TOEFL, some inference required, plausible distractors.",
  hard: "CEFR B2+ to C1 level: denser sentences, lower-frequency academic vocabulary, more inference and purpose questions, distractors that stay close to the text (partial matches, overstatements, swapped details).",
};
const lv = (i) => LEVEL[i.level] || LEVEL.standard;

// Multiple-choice item schema shared by Reading and Listening.
const QSCHEMA = `{
  "q": "question in English",
  "choices": ["choice A", "choice B", "choice C", "choice D"],
  "answer": 0,
  "tag": "exactly one of: 主旨 / 詳細 / 推測 / 語彙 / 目的 / 話し手の意図 / 構成",
  "explain_ja": "正解の根拠を日本語で。本文（音声）のどの表現が、正解の選択肢でどう言い換えられているかを具体的に示す",
  "paraphrase": {"from": "本文（音声）の表現（英語）", "to": "正解の選択肢での言い換え（英語）"},
  "why_wrong_ja": ["各選択肢がなぜ誤りか（日本語・1文）。正解の位置は空文字", "", "", ""],
  "trap": ["各選択肢の誤答タイプ：本文にない／言い過ぎ／部分一致／すり替え／逆の内容 のいずれか。正解の位置は空文字", "", "", ""]
}`;
const QRULES = `Rules for questions: exactly 4 choices; vary the position of the correct answer; every distractor must be
wrong for a reason you can state; never make two choices both defensible; why_wrong_ja and trap arrays have
exactly 4 entries aligned with choices.`;

const TASKS = {
  // ---- generation -------------------------------------------------
  gen_email: {
    max_tokens: 1200,
    prompt: (i) => `${COMMON}

Create one "Write an Email" task for Writing practice.
Topic area: ${i.topic || "campus life or university administration"}.
The situation is a realistic university e-mail scenario (asking an office, replying to a professor,
requesting a change, raising a problem). Vocabulary at CEFR B2.

JSON shape:
{
 "situation_en": "2-4 sentences setting the scene, in English",
 "situation_ja": "same situation summarised in Japanese",
 "instruction_en": "what the learner must write, e.g. who to write to and what to include",
 "recipient": "e.g. the Housing Office",
 "points": ["bullet 1 the e-mail must cover", "bullet 2", "bullet 3"],
 "time_limit_sec": 600,
 "min_words": 90,
 "useful_phrases": [{"en":"phrase","ja":"日本語の意味"}, ...4 items]
}`,
  },

  gen_interview: {
    max_tokens: 900,
    prompt: (i) => `${COMMON}

Create one "Take an Interview" Speaking question.
Topic area: ${i.topic || "everyday academic and personal experience"}.
It must be answerable in about 45-60 seconds by a B2 speaker and invite a reason plus a concrete example.

JSON shape:
{
 "question_en": "the interview question in English, one or two sentences",
 "question_ja": "日本語訳",
 "prep_sec": 15,
 "speak_sec": 60,
 "hint_ja": "答え方の骨組みを一文で（答え→理由→具体例）",
 "useful_phrases": [{"en":"phrase","ja":"意味"}, ...3 items]
}`,
  },

  // ---- evaluation -------------------------------------------------
  eval_writing: {
    max_tokens: 2000,
    prompt: (i) => `${COMMON}

Evaluate this "Write an Email" response.

TASK: ${i.task || ""}
POINTS TO COVER: ${(i.points || []).join(" / ")}
LEARNER'S E-MAIL:
"""
${i.answer || ""}
"""
Word count: ${i.words || 0}. Time used: ${i.seconds || 0} seconds.

JSON shape (all Japanese fields in natural Japanese):
{
 "band": 4.0,
 "band_note_ja": "このバンドは公式採点ではない概算である旨を一文で",
 "scores": {"task_response": 4, "organization": 4, "grammar": 3, "vocabulary": 4},
 "task_response_ja": "課題への対応の講評（2-3文）",
 "organization_ja": "構成の講評（2-3文）",
 "grammar_ja": "文法の講評（2-3文）",
 "vocabulary_ja": "語彙の講評（2-3文）",
 "good_points_ja": ["良かった点1", "良かった点2"],
 "improvements_ja": ["改善点1", "改善点2"],
 "corrections": [{"before":"原文の該当箇所","after":"直した形","why_ja":"直した理由"}, ...up to 6],
 "revised_en": "添削後の全文（英語）",
 "paraphrases": [{"from":"学習者の表現","to":"B2らしい言い換え","ja":"ニュアンスの違い"}, ...3],
 "unknown_words": [{"en":"覚えたい語句","ja":"意味"}, ...up to 5]
}`,
  },

  eval_speaking: {
    max_tokens: 2000,
    prompt: (i) => `${COMMON}

Evaluate this "Take an Interview" answer. The input is a TRANSCRIPT, so you must NOT judge
pronunciation, intonation, stress, or pausing - say so explicitly in "not_assessed_ja".

QUESTION: ${i.question || ""}
TRANSCRIPT:
"""
${i.transcript || ""}
"""
Spoken for ${i.seconds || 0} seconds, ${i.words || 0} words
(speaking rate ${i.seconds ? Math.round(((i.words || 0) / i.seconds) * 60) : 0} words per minute).
Comment on whether the length and rate suit a 45-60 second answer.

JSON shape:
{
 "band": 4.0,
 "band_note_ja": "公式採点とは一致しない概算である旨を一文で",
 "scores": {"content": 4, "organization": 4, "grammar": 3, "vocabulary": 4},
 "content_ja": "内容の講評（2-3文）",
 "organization_ja": "構成（答え→理由→具体例）の講評（2-3文）",
 "grammar_ja": "文法の講評（2-3文）",
 "vocabulary_ja": "語彙の講評（2-3文）",
 "delivery_ja": "秒数・語数・話す速さについてのコメント（2文）",
 "not_assessed_ja": "発音・抑揚・間は文字起こしからは判定できないため評価していない旨",
 "good_points_ja": ["良かった点1", "良かった点2"],
 "improvements_ja": ["改善点1", "改善点2"],
 "paraphrases": [{"from":"学習者の表現","to":"B2らしい言い換え","ja":"ニュアンス"}, ...3],
 "model_answer_en": "模範回答の例（45-60秒で話せる長さ、英語）",
 "model_answer_ja": "模範回答の日本語訳",
 "unknown_words": [{"en":"覚えたい語句","ja":"意味"}, ...up to 5]
}`,
  },


  // ---- Reading ----------------------------------------------------
  gen_r_words: {
    max_tokens: 1200,
    prompt: (i) => `${COMMON}

Create the source text for one "Complete the Words" task (a C-test). Difficulty: ${lv(i)}
Topic: ${i.topic || "an academic subject"}.
Write ONE coherent academic paragraph of 75-95 words in 5-6 sentences. The first sentence should be short and
complete the context. Use ordinary words (no proper nouns, numbers, hyphenated words or abbreviations after
the first sentence) so that every word can be completed from context. Do NOT insert blanks yourself; the app
removes letters automatically.

JSON shape:
{"title": "short English title", "paragraph": "the paragraph", "summary_ja": "段落の要旨（日本語1文）",
 "glossary": [{"en": "word as it appears", "ja": "意味"}, ...8 items, words from the paragraph worth learning]}`,
  },

  gen_r_daily: {
    max_tokens: 2600,
    prompt: (i) => `${COMMON}

Create one "Read in Daily Life" task. Difficulty: ${lv(i)}
Text type: ${i.topic || "a notice posted on campus"}.
The text is a realistic non-academic text from university life, 90-150 words, with line breaks where the
real thing would have them (headings, sender, times, bullet-like lines). Then write 3 questions.
${QRULES}

JSON shape:
{"genre_ja": "掲示／メール／SNS投稿 など", "title": "short English title", "text": "the text with \\n line breaks",
 "questions": [${QSCHEMA}, ...3 items],
 "key_words": [{"en": "word", "ja": "意味"}, ...4 items]}`,
  },

  gen_r_academic: {
    max_tokens: 3600,
    prompt: (i) => `${COMMON}

Create one "Read an Academic Passage" task. Difficulty: ${lv(i)}
Topic: ${i.topic || "an academic subject"}.
Write an expository passage of about 200 words in 2-3 paragraphs (separate paragraphs with \\n\\n), like an
introductory university textbook. Then write 5 questions covering: the main idea, two details, one
vocabulary-in-context question, and one inference or purpose question.
${QRULES}

JSON shape:
{"title": "English title", "passage": "the passage",
 "questions": [${QSCHEMA}, ...5 items],
 "key_words": [{"en": "word", "ja": "意味"}, ...5 items]}`,
  },

  // ---- Listening --------------------------------------------------
  gen_l_response: {
    max_tokens: 2600,
    prompt: (i) => `${COMMON}

Create ${i.count || 4} "Listen and Choose a Response" items. Difficulty: ${lv(i)}
Each item is one short spoken question or statement from campus or daily life (4-14 words) and four possible
spoken replies. The learner only HEARS the prompt. The best reply must be natural and responsive, often indirect
(not just repeating words from the prompt); distractors should include a reply that reuses a word from the prompt
but does not answer it, and a reply with the wrong tense or wrong question type. Alternate speakers F and M.

JSON shape:
{"items": [{
  "speaker": "F or M", "prompt": "what the first speaker says",
  "choices": ["reply A", "reply B", "reply C", "reply D"], "answer": 0, "tag": "応答",
  "explain_ja": "なぜその応答が自然か（日本語）",
  "paraphrase": {"from": "", "to": ""},
  "why_wrong_ja": ["", "", "", ""], "trap": ["音の引っかけ／話がかみ合わない／時制のずれ／疑問詞のずれ 等。正解は空文字", "", "", ""]
}, ...]}`,
  },

  gen_l_conversation: {
    max_tokens: 2600,
    prompt: (i) => `${COMMON}

Create one "Listen to a Conversation" task. Difficulty: ${lv(i)}
Setting: ${i.topic || "two students talking on campus"}.
Write a natural everyday conversation between a woman (F) and a man (M), 8-12 turns, about 130-170 words in
total, with natural spoken features (hesitations like "Well," "Actually," short reactions). Then 2 questions
(one about the main topic or problem, one about a detail, intention, or what a speaker will do next).
${QRULES}

JSON shape:
{"setting_ja": "場面の説明（日本語1文）",
 "lines": [{"sp": "F", "text": "..."}, {"sp": "M", "text": "..."}],
 "questions": [${QSCHEMA}, ...2 items],
 "key_words": [{"en": "word or phrase", "ja": "意味"}, ...3 items]}`,
  },

  gen_l_announcement: {
    max_tokens: 2200,
    prompt: (i) => `${COMMON}

Create one "Listen to an Announcement" task. Difficulty: ${lv(i)}
Context: ${i.topic || "a professor making an announcement at the start of class"}.
One speaker, 90-130 words, spoken style. Then 2 questions (purpose of the announcement, and a detail or
what listeners must do).
${QRULES}

JSON shape:
{"speaker": "F or M", "context_ja": "場面（日本語1文）", "text": "the announcement",
 "questions": [${QSCHEMA}, ...2 items],
 "key_words": [{"en": "word or phrase", "ja": "意味"}, ...3 items]}`,
  },

  gen_l_talk: {
    max_tokens: 3400,
    prompt: (i) => `${COMMON}

Create one "Listen to an Academic Talk" task. Difficulty: ${lv(i)}
Topic: ${i.topic || "an academic subject"}.
A lecture excerpt by one professor, 180-240 words, spoken style (signposting such as "Now, let's turn to...",
"So why does this matter?", a concrete example). Then 4 questions: main topic, two details, and one about the
purpose of something the professor says or an inference.
${QRULES}

JSON shape:
{"speaker": "F or M", "title": "English title", "text": "the talk",
 "questions": [${QSCHEMA}, ...4 items],
 "key_words": [{"en": "word or phrase", "ja": "意味"}, ...5 items]}`,
  },

  // ---- review quiz ------------------------------------------------
  gen_review: {
    max_tokens: 1200,
    prompt: (i) => `${COMMON}

Build a short review quiz from the learner's own notebook entries below.
ENTRIES: ${JSON.stringify(i.items || []).slice(0, 4000)}

Make ${i.count || 5} multiple-choice questions that test whether the learner can USE these words
or phrases in context (fill in the blank in a natural sentence), not just translate them.

JSON shape:
{"questions":[{"prompt_en":"sentence with ____","choices":["a","b","c","d"],"answer":0,"explain_ja":"なぜその答えか、他の選択肢がなぜ違うか"}]}`,
  },
};

function extractJson(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch (e) {
    const s = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (s !== -1 && end > s) return JSON.parse(t.slice(s, end + 1));
    throw e;
  }
}

/* ---------- providers ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geminiOnce(model, key, prompt, maxTokens, think) {
  const generationConfig = {
    responseMimeType: "application/json",
    // maxOutputTokens counts thinking tokens too, so leave generous headroom.
    maxOutputTokens: Math.max(maxTokens * 2, maxTokens + 3000),
    temperature: 0.9,
  };
  if (think) generationConfig.thinkingConfig = { thinkingLevel: /lite/.test(model) ? "minimal" : "low" };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
    }
  );
  if (!res.ok) {
    const detail = await res.text();
    // If this model rejects the thinking setting, try once more without it.
    if (think && res.status === 400 && /thinking/i.test(detail)) return geminiOnce(model, key, prompt, maxTokens, false);
    const err = new Error("gemini");
    err.status = res.status;
    err.detail = detail.slice(0, 500);
    throw err;
  }
  const data = await res.json();
  const cand = (data.candidates || [])[0] || {};
  if (cand.finishReason === "SAFETY") throw { user: "内容が安全フィルタに触れました。別の課題でもう一度お試しください。", code: 502 };
  return ((cand.content && cand.content.parts) || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
}

async function callGemini(prompt, maxTokens) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw { user: "サーバーにAPIキーが設定されていません（Netlifyの環境変数 GEMINI_API_KEY を確認してください）", code: 500 };

  // 混雑(503)や瞬間的な超過(429)に備え、同じモデルで一度待って再試行し、
  // それでも駄目なら軽いモデルに切り替える。
  const primary = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const fallback = process.env.GEMINI_MODEL_FALLBACK || "gemini-3.5-flash-lite";
  const chain = [
    { model: primary, wait: 0 },
    { model: primary, wait: 1500 },
    { model: fallback, wait: 500 },
    { model: fallback, wait: 2500 },
  ];

  let last = null;
  for (const step of chain) {
    if (step.wait) await sleep(step.wait);
    try {
      return await geminiOnce(step.model, key, prompt, maxTokens, true);
    } catch (e) {
      if (e && e.user) throw e;
      last = e;
      if (e.status === 503 || e.status === 429 || e.status >= 500) continue;
      break;
    }
  }

  const st = last && last.status;
  throw {
    user:
      st === 429
        ? "無料枠の上限に達したか混み合っています。少し待ってからもう一度お試しください。"
        : st === 503
        ? "Gemini側が混み合っています。1分ほど待ってからもう一度お試しください。"
        : st === 400 || st === 403
        ? "APIキーが正しくないか、権限がありません。Netlifyの環境変数 GEMINI_API_KEY を確認してください。"
        : "Gemini APIからエラーが返りました。",
    code: 502,
    status: st,
    detail: last && last.detail,
  };
}

async function callAnthropic(prompt, maxTokens) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw { user: "サーバーにAPIキーが設定されていません（Netlifyの環境変数 ANTHROPIC_API_KEY を確認してください）", code: 500 };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw {
      user: res.status === 429 ? "混み合っています。少し待ってからもう一度お試しください。" : "Claude APIからエラーが返りました。",
      code: 502,
      detail: detail.slice(0, 500),
      status: res.status,
    };
  }
  const data = await res.json();
  return (data.content || []).map((b) => b.text || "").join("");
}

/* ---------- handler ---------- */

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "POSTのみ受け付けます" }) };

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "リクエストの形式が不正です" }) };
  }

  const task = TASKS[body.action];
  if (!task)
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `未対応の処理です: ${body.action}` }) };

  const prompt = task.prompt(body.input || {});

  let text;
  try {
    text = PROVIDER === "anthropic" ? await callAnthropic(prompt, task.max_tokens) : await callGemini(prompt, task.max_tokens);
  } catch (e) {
    if (e && e.user)
      return { statusCode: e.code || 502, headers: CORS, body: JSON.stringify({ error: e.user, status: e.status, detail: e.detail }) };
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ error: "通信に失敗しました。接続を確認してもう一度お試しください。", detail: String(e).slice(0, 300) }),
    };
  }

  try {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, data: extractJson(text) }) };
  } catch {
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ error: "返答の形式が崩れていました。もう一度お試しください。", raw: String(text).slice(0, 500) }),
    };
  }
};
