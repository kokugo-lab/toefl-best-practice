// Claude API proxy for the TOEFL practice app.
// The API key never reaches the browser: it lives in the Netlify env var ANTHROPIC_API_KEY.

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

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

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "POSTのみ受け付けます" }) };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "サーバーにAPIキーが設定されていません（Netlifyの環境変数 ANTHROPIC_API_KEY を確認してください）" }),
    };

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "リクエストの形式が不正です" }) };
  }

  const task = TASKS[body.action];
  if (!task)
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `未対応の処理です: ${body.action}` }) };

  const payload = {
    model: MODEL,
    max_tokens: task.max_tokens,
    messages: [{ role: "user", content: task.prompt(body.input || {}) }],
  };

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const detail = await res.text();
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({
          error: res.status === 429 ? "混み合っています。少し待ってからもう一度お試しください。" : "Claude APIからエラーが返りました。",
          status: res.status,
          detail: detail.slice(0, 500),
        }),
      };
    }

    const data = await res.json();
    const text = (data.content || []).map((b) => b.text || "").join("");
    let parsed;
    try {
      parsed = extractJson(text);
    } catch {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ error: "返答の形式が崩れていました。もう一度お試しください。", raw: text.slice(0, 500) }),
      };
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, data: parsed }) };
  } catch (e) {
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ error: "通信に失敗しました。接続を確認してもう一度お試しください。", detail: String(e).slice(0, 300) }),
    };
  }
};
