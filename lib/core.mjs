// LLM proxy for the TOEFL / IELTS practice app (shared by every host).
// The API key never reaches the browser: it lives in a server-side environment variable.
// Thin adapters call handle():
//   Cloudflare Pages -> functions/api/claude.js
//   Netlify          -> netlify/functions/claude.mjs
//
// Provider is chosen with LLM_PROVIDER ("gemini" by default, or "anthropic").
//   gemini    -> GEMINI_API_KEY   (+ optional GEMINI_MODEL, default gemini-3.8-flash)
//   anthropic -> ANTHROPIC_API_KEY (+ optional CLAUDE_MODEL, default claude-sonnet-5-5)

export const CORS = {
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

const IELTS_COMMON = `You are an experienced IELTS Academic examiner and teacher who knows the public band descriptors.
The learner is a Japanese adult preparing for graduate school admission (CEFR B2, aiming at about band 6.0-6.5).
Everything you produce is ORIGINAL practice material modelled on IELTS Academic, never actual official test content.
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

// 学習者が苦手な設問タイプ・文法項目を多めに出す（端末側の正答率から選んだもの）
const focus = (i) =>
  Array.isArray(i.focus) && i.focus.length
    ? `\nThe learner is weak at these question types / grammar points (written exactly as the Japanese tag names used in "tag"): ${i.focus
        .slice(0, 3)
        .join(", ")}. Make about half of the questions target them where the format allows, and keep the tag field accurate.`
    : "";

// 書き直し・答え直しの評価
const rw = (i) =>
  i.previous
    ? `\nThis is a REWRITE / SECOND ATTEMPT of the same task. The earlier attempt was estimated at band ${
        i.previous.band
      }; earlier feedback: ${(i.previous.improvements || []).join(" / ")}. Score this attempt independently and honestly
(do not raise the score just because it is a rewrite), and ADD a field "rewrite_ja" to the JSON: 2-3 Japanese sentences
on which earlier problems were fixed and which remain.`
    : "";

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

  gen_interview_set: {
    max_tokens: 1200,
    prompt: (i) => `${COMMON}

Create one "Take an Interview" set in the new TOEFL format: an interviewer asks 4 questions in a row about
ONE theme (${i.topic || "a university research study on student life"}). The learner answers each in about 45
seconds without preparation time. Order the questions: (1) the learner's own experience, (2) a preference with
a reason, (3) an opinion on a related issue, (4) a broader question about society or the future.${focus(i)}

JSON shape:
{
 "theme_en": "one sentence the interviewer says to introduce the theme",
 "theme_ja": "テーマの説明（日本語1文）",
 "questions": [{"question_en": "question", "question_ja": "日本語訳"}, ...4 items],
 "useful_phrases": [{"en":"phrase","ja":"意味"}, ...4 items]
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
Word count: ${i.words || 0}. Time used: ${i.seconds || 0} seconds.${rw(i)}

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
Comment on whether the length and rate suit an answer of about ${i.limit || 60} seconds.${rw(i)}

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
 "model_answer_en": "模範回答の例（${i.limit || 60}秒で話せる長さ、英語）",
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
${QRULES}${focus(i)}

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
${QRULES}${focus(i)}

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
${QRULES}${focus(i)}

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
${QRULES}${focus(i)}

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
${QRULES}${focus(i)}

JSON shape:
{"speaker": "F or M", "title": "English title", "text": "the talk",
 "questions": [${QSCHEMA}, ...4 items],
 "key_words": [{"en": "word or phrase", "ja": "意味"}, ...5 items]}`,
  },

  // ---- Speaking: Listen and Repeat --------------------------------
  gen_repeat: {
    max_tokens: 1400,
    prompt: (i) => `${COMMON}

Create one "Listen and Repeat" set for Speaking practice.
Setting: ${i.topic || "a guide giving new students a campus tour"}.
Write 7 sentences that this one speaker would naturally say, in order, as if guiding the listeners.
The sentences get longer: about 5-7, 7-9, 9-11, 11-13, 13-15, 15-17 and 17-20 words.
Natural spoken English at CEFR B2. Do NOT use numerals, dates, times, proper names or abbreviations
(they are hard to repeat and to transcribe). Each sentence must be complete and make sense on its own.

JSON shape:
{"setting_en": "short English description of the scene", "setting_ja": "場面の説明（日本語1文）",
 "speaker": "F or M",
 "sentences": [{"en": "sentence", "ja": "日本語訳"}, ...7 items],
 "key_words": [{"en": "word or phrase", "ja": "意味"}, ...3 items]}`,
  },

  // ---- Writing: Build a Sentence ----------------------------------
  gen_build: {
    max_tokens: 1800,
    prompt: (i) => `${COMMON}

Create ${i.count || 5} "Build a Sentence" items for Writing practice. Difficulty: ${lv(i)}
Situations: ${i.topic || "campus life and classes"}.
Each item is a short exchange. Speaker A says one line (the context). Speaker B's reply (7-13 words) must be
assembled by the learner from word chunks.
- "prefix": 0-2 words fixed at the start of B's reply (may be an empty string).
- "chunks": the REST of B's reply, split into 5-7 chunks of 1-3 words each, listed in the CORRECT order,
  without the final punctuation mark.
- Exactly ONE order of the chunks may be grammatical and natural: never create chunks that could be swapped
  (two adverbs, two adjectives, two prepositional phrases), and never repeat the same chunk.
- "distractor": one extra chunk that looks tempting but makes the sentence ungrammatical if used
  (e.g. "does" inside an embedded question, a wrong preposition, a wrong verb form), or "" for none.
Target grammar a B2 learner must control: embedded questions, relative clauses, passive voice, perfect tenses,
conditionals, comparatives, infinitives and gerunds, phrasal verbs. Use a different grammar point per item.${focus(i)}

JSON shape:
{"items": [{
  "context": "what speaker A says",
  "prefix": "",
  "chunks": ["chunk", "chunk", "chunk", "chunk", "chunk"],
  "end": "? or .",
  "distractor": "",
  "tag": "exactly one of: 間接疑問 / 関係詞 / 受動態 / 時制 / 仮定法 / 比較 / 不定詞・動名詞 / 句動詞 / 語順その他",
  "ja": "Bの文の日本語訳",
  "grammar_ja": "語順のポイントを日本語1-2文で（なぜこの順番になるか。ダミーの語があればなぜ使えないか）"
}, ...]}`,
  },

  // ---- Writing: Academic Discussion -------------------------------
  gen_discussion: {
    max_tokens: 1600,
    prompt: (i) => `${COMMON}

Create one "Write for an Academic Discussion" task.
Course: ${i.topic || "sociology"}.
The professor posts on an online class discussion board (60-90 words): brief background, then one clear
question that invites an opinion and has at least two defensible sides. Two students have already replied
(40-60 words each) with DIFFERENT positions, each with one reason or example. The learner will write a reply
of at least 100 words. Vocabulary at CEFR B2.

JSON shape:
{"course": "course name in English",
 "professor": "e.g. Dr. Lee",
 "professor_post": "the professor's post",
 "question_ja": "教授の問いの要点（日本語1-2文）",
 "students": [{"name": "first name", "post": "reply"}, {"name": "first name", "post": "reply"}],
 "time_limit_sec": 600,
 "min_words": 100,
 "useful_phrases": [{"en":"phrase","ja":"日本語の意味"}, ...4 items]}`,
  },

  eval_discussion: {
    max_tokens: 2000,
    prompt: (i) => `${COMMON}

Evaluate this "Write for an Academic Discussion" response.

PROFESSOR'S POST: ${i.professor || ""}
CLASSMATES' POSTS:
${(i.students || []).map((s) => `- ${s.name}: ${s.post}`).join("\n")}
LEARNER'S POST:
"""
${i.answer || ""}
"""
Word count: ${i.words || 0}. Time used: ${i.seconds || 0} seconds.${rw(i)}
Judge especially: a clear position that answers the professor's question; a reason supported by a specific
example or explanation; whether it engages with the classmates' ideas AND adds a new point instead of
repeating them; coherence; grammar; range and precision of vocabulary; length (about 100 words or more).

JSON shape (all Japanese fields in natural Japanese):
{
 "band": 4.0,
 "band_note_ja": "このバンドは公式採点ではない概算である旨を一文で",
 "scores": {"task_response": 4, "organization": 4, "grammar": 3, "vocabulary": 4},
 "task_response_ja": "問いへの答え・新しい視点の有無・クラスメートへの言及の講評（2-3文）",
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

  // ==================================================================
  // IELTS Academic
  // ==================================================================
  gen_i_read_passage: {
    max_tokens: 1800,
    prompt: (i) => `${IELTS_COMMON}

Write one IELTS Academic Reading passage. Topic: ${i.topic || "an academic subject"}.
About 650-750 words: exactly 6 paragraphs (separate paragraphs with \\n\\n), EACH paragraph 6-7 sentences and
110-130 words - do not write shorter paragraphs. In the style of a magazine or journal
article for a general educated audience: specific details, dates, researchers' views, contrasts and some
hedged claims (the kind of content that supports TRUE / FALSE / NOT GIVEN questions). Do not write questions.

JSON shape:
{"title": "English title", "passage": "the passage", "summary_ja": "要旨（日本語1-2文）"}`,
  },

  gen_i_read_qs: {
    max_tokens: 2600,
    prompt: (i) => `${IELTS_COMMON}

Write 13 IELTS Academic Reading questions for the passage below, in the order the information appears within
each group.
- 5 items of type "tfng": a statement; answer is "TRUE", "FALSE" or "NOT GIVEN" (use each at least once).
- 4 items of type "mcq": 4 choices, one correct.
- 4 items of type "gap": a sentence with "____" to complete with NO MORE THAN TWO WORDS taken exactly from the
  passage; "answer" lists the accepted answer(s) (lower case).${focus(i)}

PASSAGE:
"""
${String(i.passage || "").slice(0, 7000)}
"""

JSON shape:
{"questions": [
 {"type": "tfng", "q": "statement", "answer": "TRUE", "tag": "TFNG", "explain_ja": "根拠と判断の理由（日本語1-2文）", "evidence": "本文の該当箇所（英語の引用）"},
 {"type": "mcq", "q": "question", "choices": ["A","B","C","D"], "answer": 0, "tag": "多肢選択", "explain_ja": "...", "evidence": "...",
  "why_wrong_ja": ["各選択肢がなぜ誤りか。正解の位置は空文字", "", "", ""]},
 {"type": "gap", "q": "sentence with ____", "answer": ["word"], "tag": "文完成", "explain_ja": "...", "evidence": "..."}
],
 "key_words": [{"en": "word", "ja": "意味"}, ...5 items]}`,
  },

  gen_i_listen: {
    max_tokens: 2600,
    think: "low", // "minimal" だと台本が指定の長さの半分ほどになるため
    prompt: (i) => {
      const P = {
        1: `Part 1: a conversation between two people (F and M) in an everyday social context (${i.topic ||
          "booking or enquiring about a service"}), about 350-420 words in 28-36 short turns. One speaker gives personal details, times, prices
or addresses, and spells at least one name letter by letter (e.g. "That's B-R-O-W-N").
Questions: 10 items of type "gap" (form or note completion, ONE WORD AND/OR A NUMBER).`,
        2: `Part 2: a monologue by one speaker in an everyday social context (${i.topic ||
          "a guide introducing a local facility"}), about 400-480 words (about 30 sentences; split it into 4-6 "lines" entries by topic).
Questions: 5 items of type "mcq" then 5 items of type "gap" (note completion, ONE WORD ONLY).`,
        3: `Part 3: a conversation between a student and a tutor, or two students (F and M), about an academic assignment
(${i.topic || "planning a research project"}), about 420-500 words in 22-30 turns of 1-3 sentences, with opinions, agreement and disagreement.
Questions: 6 items of type "mcq" then 4 items of type "gap" (NO MORE THAN TWO WORDS).`,
        4: `Part 4: a lecture by one speaker on an academic subject (${i.topic || "an academic subject"}), about 500-600
words (about 35-40 sentences; split it into 5-7 "lines" entries, one per section of the talk), with clear signposting.
Questions: 10 items of type "gap" (note completion, ONE WORD ONLY). The notes follow the order of the lecture.`,
      }[i.part || 1];
      return `${IELTS_COMMON}

Create one IELTS Listening section.
${P}
Do not shorten the script: its length matters as much as the questions.
Every answer must be heard clearly in the script, in the same order as the questions. For "gap" items the
answer must be words actually spoken; give accepted variants (e.g. "15" and "fifteen"). Write numbers in the
script as words so text-to-speech reads them naturally.${focus(i)}

JSON shape:
{"context_ja": "場面の説明（日本語1文）",
 "lines": [{"sp": "F or M", "text": "..."}],
 "limit": "ONE WORD AND/OR A NUMBER など、gap の語数制限（英語）",
 "questions": [
  {"type": "gap", "q": "note or form line with ____", "answer": ["accepted", "variant"], "tag": "メモ完成", "explain_ja": "スクリプトのどこで言われたか（日本語）"},
  {"type": "mcq", "q": "question", "choices": ["A","B","C"], "answer": 0, "tag": "多肢選択", "explain_ja": "...", "why_wrong_ja": ["", "", ""]}
 ],
 "key_words": [{"en": "word or phrase", "ja": "意味"}, ...4 items]}`;
    },
  },

  gen_i_task1: {
    max_tokens: 1400,
    prompt: (i) => `${IELTS_COMMON}

Create one IELTS Academic Writing Task 1 prompt with its data. Chart type: ${i.chart || "bar"}.
Subject: ${i.topic || "a social or economic statistic"}.
The data must be realistic, have clear main features (a highest/lowest, a trend, a notable exception) and
be small enough to describe in 150 words: 3-6 categories (or 5-7 time points for a line chart) and 1-4 series.
For "pie", use exactly one series whose values add up to 100.

JSON shape:
{"chart": {"type": "bar | line | pie | table", "title": "chart title", "unit": "e.g. %, million, hours",
   "x_label": "label of the categories axis", "categories": ["..."],
   "series": [{"name": "series name", "values": [numbers, one per category]}]},
 "prompt_en": "The chart below shows ... Summarise the information by selecting and reporting the main features, and make comparisons where relevant.",
 "prompt_ja": "日本語訳",
 "key_features_ja": ["書くべき主な特徴1", "特徴2", "特徴3"],
 "time_limit_sec": 1200, "min_words": 150,
 "useful_phrases": [{"en":"phrase","ja":"意味"}, ...4 items]}`,
  },

  gen_i_task2: {
    max_tokens: 1000,
    prompt: (i) => `${IELTS_COMMON}

Create one IELTS Academic Writing Task 2 prompt. Question type: ${i.kind || "agree or disagree"}.
Topic area: ${i.topic || "education"}. A statement of 1-2 sentences followed by the task instruction, in the
usual IELTS wording, ending with "Give reasons for your answer and include any relevant examples from your own
knowledge or experience."

JSON shape:
{"prompt_en": "the full prompt", "prompt_ja": "日本語訳", "type_ja": "設問のタイプ（賛否／両論／問題と解決策 など）",
 "plan_ja": "構成の例（序論→本論2段落→結論）を日本語2-3文で",
 "time_limit_sec": 2400, "min_words": 250,
 "useful_phrases": [{"en":"phrase","ja":"意味"}, ...4 items]}`,
  },

  eval_i_writing: {
    max_tokens: 2400,
    prompt: (i) => `${IELTS_COMMON}

Evaluate this IELTS Academic Writing Task ${i.task || 2} response with the four public band descriptors
(Task ${i.task == 1 ? "Achievement" : "Response"}, Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy).

PROMPT: ${i.prompt || ""}
${i.chart ? `DATA SHOWN TO THE CANDIDATE: ${JSON.stringify(i.chart).slice(0, 2500)}` : ""}
RESPONSE:
"""
${i.answer || ""}
"""
Word count: ${i.words || 0} (minimum ${i.task == 1 ? 150 : 250}). Time used: ${i.seconds || 0} seconds.
${i.task == 1 ? "Check: an overview of the main features, accurate data, comparisons, no opinion." : "Check: a clear position throughout, developed and supported ideas, paragraphing."}${rw(i)}

JSON shape (all Japanese fields in natural Japanese, bands 0-9 in steps of 0.5):
{
 "band": 6.0,
 "band_note_ja": "公式採点とは一致しない概算である旨を一文で",
 "scores": {"task": 6, "coherence": 6, "lexical": 6, "grammar": 5.5},
 "task_response_ja": "課題の達成度の講評（2-3文）",
 "organization_ja": "一貫性とつながりの講評（2-3文）",
 "vocabulary_ja": "語彙の講評（2-3文）",
 "grammar_ja": "文法の講評（2-3文）",
 "good_points_ja": ["良かった点1", "良かった点2"],
 "improvements_ja": ["次のバンドに上がるための改善点1", "改善点2"],
 "corrections": [{"before":"原文の該当箇所","after":"直した形","why_ja":"直した理由"}, ...up to 6],
 "revised_en": "添削後の全文（英語）",
 "paraphrases": [{"from":"学習者の表現","to":"より高いバンドの言い換え","ja":"ニュアンスの違い"}, ...3],
 "unknown_words": [{"en":"覚えたい語句","ja":"意味"}, ...up to 5]
}`,
  },

  gen_i_speaking: {
    max_tokens: 1400,
    prompt: (i) => `${IELTS_COMMON}

Create one IELTS Speaking test.
Part 1: 4 short questions on a familiar topic (${i.topic1 || "home town, studies or work, daily routine"}).
Part 2: one cue card "Describe ..." (${i.topic2 || "a person, place, object or experience"}) with 4 bullet prompts,
the last starting "and explain ...".
Part 3: 4 discussion questions that develop the Part 2 theme into abstract, societal issues.

JSON shape:
{"part1": {"topic": "topic", "questions": [{"en": "question", "ja": "日本語訳"}, ...4]},
 "part2": {"cue_en": "Describe ...", "ja": "日本語訳", "points": ["You should say: what ...", "when ...", "why ...", "and explain ..."]},
 "part3": {"questions": [{"en": "question", "ja": "日本語訳"}, ...4]},
 "useful_phrases": [{"en":"phrase","ja":"意味"}, ...4 items]}`,
  },

  eval_i_speaking: {
    max_tokens: 2400,
    prompt: (i) => `${IELTS_COMMON}

Evaluate this IELTS Speaking performance. The input is a TRANSCRIPT, so you must NOT judge Pronunciation
(or intonation, stress, pausing) - say so in "not_assessed_ja" and give no pronunciation score. Assess Fluency and
Coherence only from what a transcript shows (length, development, linking, self-correction, fillers).

${(i.items || [])
  .map(
    (x, k) => `[${k + 1}] Part ${x.part} - QUESTION: ${x.question}
TRANSCRIPT (${x.seconds || 0} s, ${x.words || 0} words): """${x.transcript || ""}"""`
  )
  .join("\n")
  .slice(0, 9000)}${rw(i)}

JSON shape (bands 0-9 in steps of 0.5):
{
 "band": 6.0,
 "band_note_ja": "公式採点とは一致しない概算で、発音を含まない旨を一文で",
 "scores": {"fluency": 6, "lexical": 6, "grammar": 5.5},
 "content_ja": "各パートの答えの内容・展開の講評（2-3文）",
 "organization_ja": "流暢さと一貫性（つなぎ言葉・話の展開）の講評（2-3文）",
 "vocabulary_ja": "語彙の講評（2-3文）",
 "grammar_ja": "文法の講評（2-3文）",
 "delivery_ja": "長さ・話す速さのコメント（Part 2 が2分近く話せているか等、2文）",
 "not_assessed_ja": "発音は文字起こしから判定できないため評価していない旨",
 "good_points_ja": ["良かった点1", "良かった点2"],
 "improvements_ja": ["次のバンドに上がるための改善点1", "改善点2"],
 "paraphrases": [{"from":"学習者の表現","to":"より高いバンドの言い換え","ja":"ニュアンス"}, ...3],
 "model_answer_en": "Part 2（なければ最初の質問）の模範回答例（英語）",
 "model_answer_ja": "模範回答の日本語訳",
 "unknown_words": [{"en":"覚えたい語句","ja":"意味"}, ...up to 5]
}`,
  },

  // ==================================================================
  // 適性診断（TOEFL と IELTS のどちらが向いているか）
  // ==================================================================
  gen_fit_a: {
    max_tokens: 1800,
    prompt: (i) => `${IELTS_COMMON}

Create the reading material for a short diagnostic test (CEFR B2 level).
1) "passage": an IELTS Academic style passage of 330-380 words in 4 paragraphs (separate with \\n\\n) on
   ${i.topic || "an academic subject"}, with specific details, dates and hedged claims.
2) "tfng": 4 statements about the passage, answers TRUE / FALSE / NOT GIVEN (use each at least once).
3) "ctest": ONE separate academic paragraph of 55-70 words in 4 sentences on a different everyday-science topic,
   ordinary words only (no proper nouns, numbers, hyphens or abbreviations).

JSON shape:
{"title": "passage title", "passage": "...",
 "tfng": [{"q": "statement", "answer": "TRUE", "explain_ja": "判断の理由（日本語1文）"}, ...4],
 "ctest": "the paragraph"}`,
  },

  gen_fit_b: {
    max_tokens: 1800,
    prompt: (i) => `${COMMON}

Create the listening and grammar material for a short diagnostic test (CEFR B2 level).
1) "mono": a monologue of 90-120 words by one speaker (${i.topic || "a staff member giving information about a weekend course"})
   that includes a surname spelled letter by letter (e.g. "That's H-A-R-T"), a day or time, and a price or number
   (write numbers as words so text-to-speech reads them naturally).
2) "gaps": 3 note-completion items answered by words actually spoken in "mono", in order (ONE WORD AND/OR A NUMBER);
   "answer" lists accepted variants in lower case (e.g. ["hart"], ["15", "fifteen"]).
3) "responses": 3 "Listen and Choose a Response" items: a short spoken question or statement (5-12 words) and 4
   replies; the best reply is natural and often indirect.
4) "build": 2 "Build a Sentence" items (same rules as usual: context line, prefix, 5-6 chunks in the only correct
   order, end mark, one tempting distractor chunk or "").

JSON shape:
{"mono_speaker": "F or M", "mono": "...",
 "gaps": [{"q": "Teacher's surname: ____", "answer": ["hart"]}, ...3],
 "responses": [{"prompt": "...", "choices": ["A","B","C","D"], "answer": 0}, ...3],
 "build": [{"context": "...", "prefix": "", "chunks": ["..."], "end": ".", "distractor": "", "tag": "間接疑問", "ja": "訳", "grammar_ja": "ポイント"}, ...2]}`,
  },

  // ==================================================================
  // 答え合わせ後の詳しい解説（その場で作る）
  // ==================================================================
  explain_ctest: {
    max_tokens: 2400,
    prompt: (i) => `${COMMON}

The learner did a "Complete the Words" (C-test) task: the second half of every other word was removed and the
learner typed the missing letters. Explain every blank in Japanese so that a B1-B2 learner understands WHY the
word must be that word: the grammatical clue (part of speech, number, tense, collocation, the word before/after)
and the meaning in context. If the learner's word is wrong, say concretely why it does not fit
(e.g. "teaching は動名詞で、直後の present の主語になれない／複数形 present に合う複数名詞が必要").

PARAGRAPH: ${String(i.paragraph || "").slice(0, 2000)}
BLANKS (in order): ${JSON.stringify(i.blanks || []).slice(0, 3000)}

JSON shape:
{"translation_ja": "段落全体の自然な日本語訳",
 "items": [{"word": "正解の語", "ja": "この文脈での意味", "pos_ja": "品詞と形（例：名詞・複数形）",
   "why_ja": "なぜこの語になるか（手がかりを1-2文で）", "user_ja": "学習者の答えが合わない理由（正解なら空文字）"}, ...same order and count as BLANKS]}`,
  },

  explain_q: {
    max_tokens: 2000,
    prompt: (i) => `${i.exam === "ielts" ? IELTS_COMMON : COMMON}

Give a detailed Japanese explanation of ONE question the learner has just answered, for a B1-B2 learner.
Be concrete: quote the exact sentence(s) of the text that decide the answer, translate them, and explain the
reasoning step by step (paraphrase, inference, distractor trap). Finish with one practical tip for this question type.

TASK TYPE: ${i.kind || ""}
TEXT (passage / script / context):
"""
${String(i.context || "").slice(0, 6000)}
"""
QUESTION: ${i.question || ""}
${Array.isArray(i.choices) && i.choices.length ? `CHOICES: ${i.choices.map((c, k) => `${String.fromCharCode(65 + k)}. ${c}`).join(" / ")}` : ""}
CORRECT ANSWER: ${i.answer || ""}
LEARNER'S ANSWER: ${i.chosen || "(no answer)"}

JSON shape (Japanese except quotes):
{"question_ja": "設問（または文）の日本語訳",
 "evidence_en": "答えを決める本文・スクリプトの該当箇所（英語のまま引用）",
 "evidence_ja": "その日本語訳",
 "steps_ja": ["解き方の手順1", "手順2", "手順3"],
 "choices": [{"ja": "選択肢の日本語訳", "why_ja": "正解の理由、または誤りの理由"}, ...選択肢と同じ数・順番（選択肢がなければ空配列）],
 "learner_ja": "学習者の答えについてのコメント（正解ならよかった点、不正解ならどこで間違えたか）",
 "tip_ja": "この形式の問題を解くコツを1-2文で"}`,
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

// think: "minimal" | "low" | null（null は思考の設定を送らない）
async function geminiOnce(model, key, prompt, maxTokens, think, ms) {
  const generationConfig = {
    responseMimeType: "application/json",
    // maxOutputTokens counts thinking tokens too, so leave generous headroom.
    maxOutputTokens: Math.max(maxTokens * 2, maxTokens + 3000),
    temperature: 0.9,
  };
  if (think) generationConfig.thinkingConfig = { thinkingLevel: /lite/.test(model) ? "minimal" : think };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
      signal: AbortSignal.timeout(Math.max(1000, ms || 20000)),
    }
  ).catch((e) => {
    const err = new Error("gemini");
    err.status = e && (e.name === "TimeoutError" || e.name === "AbortError") ? 504 : 502;
    err.detail = String(e).slice(0, 200);
    throw err;
  });
  if (!res.ok) {
    const detail = await res.text();
    // If this model rejects the thinking setting, try once more without it.
    // このモデルが指定した思考レベルを受け付けないときは、一段上げて（それでもだめなら指定なしで）やり直す。
    if (think && res.status === 400 && /thinking/i.test(detail))
      return geminiOnce(model, key, prompt, maxTokens, think === "minimal" ? "low" : null, ms);
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

async function callGemini(prompt, maxTokens, env, budget, think) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw { user: "サーバーにAPIキーが設定されていません（環境変数 GEMINI_API_KEY を確認してください）", code: 500 };

  // 全体を budget ミリ秒に収める（Netlify は30秒前後で打ち切られるので25秒、Cloudflare はもっと長く待てる）。
  // 主モデルが遅い(時間切れ)ときは軽いモデルへ、混雑(503/429)なら少し待って再試行。
  const primary = env.GEMINI_MODEL || "gemini-3.8-flash";
  const fallback = env.GEMINI_MODEL_FALLBACK || "gemini-3.5-flash-lite";
  const deadline = Date.now() + budget;
  const left = () => deadline - Date.now();
  const steps = [
    { model: primary, wait: 0, cap: budget * 0.68 },
    { model: primary, wait: 1500, cap: budget * 0.48, only: [503, 429] },
    { model: fallback, wait: 0, cap: budget * 0.6 },
    { model: fallback, wait: 1500, cap: budget * 0.6, only: [503, 429] },
  ];

  let last = null;
  for (const st of steps) {
    if (st.only && !(last && st.only.includes(last.status))) continue;
    if (st.wait) await sleep(st.wait);
    const ms = Math.min(st.cap, left() - 300);
    if (ms < 3000) break;
    try {
      return await geminiOnce(st.model, key, prompt, maxTokens, think || "low", ms);
    } catch (e) {
      if (e && e.user) throw e;
      last = e;
      if (!(e.status === 503 || e.status === 429 || e.status === 504 || e.status >= 500)) break;
    }
  }

  const st = last && last.status;
  throw {
    user:
      st === 429
        ? "無料枠の上限に達したか混み合っています。少し待ってからもう一度お試しください。"
        : st === 503
        ? "Gemini側が混み合っています。1分ほど待ってからもう一度お試しください。"
        : st === 504
        ? "生成に時間がかかりすぎました。もう一度お試しください。"
        : st === 400 || st === 403
        ? "APIキーが正しくないか、権限がありません。サーバーの環境変数 GEMINI_API_KEY を確認してください。"
        : "Gemini APIからエラーが返りました。",
    code: 502,
    status: st,
    detail: last && last.detail,
  };
}

async function callAnthropic(prompt, maxTokens, env) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw { user: "サーバーにAPIキーが設定されていません（環境変数 ANTHROPIC_API_KEY を確認してください）", code: 500 };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || "claude-sonnet-5-5",
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

// method: HTTP method, rawBody: request body text, env: environment variables, budget: ms for the LLM call.
// Returns {status, body} (body is a string); the adapter adds CORS headers.
export async function handle(method, rawBody, env, budget) {
  const out = (status, obj) => ({ status, body: obj == null ? "" : JSON.stringify(obj) });
  if (method === "OPTIONS") return out(204, null);
  if (method !== "POST") return out(405, { error: "POSTのみ受け付けます" });

  let body;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    return out(400, { error: "リクエストの形式が不正です" });
  }

  const task = TASKS[body.action];
  if (!task) return out(400, { error: `未対応の処理です: ${body.action}` });

  const prompt = task.prompt(body.input || {});
  const provider = (env.LLM_PROVIDER || "gemini").toLowerCase();
  // 問題の生成は考える時間を最小にして速くする（採点・添削は正確さのため "low" のまま）。
  const think = task.think || (body.action.startsWith("gen_") ? "minimal" : "low");

  let text;
  try {
    text =
      provider === "anthropic"
        ? await callAnthropic(prompt, task.max_tokens, env)
        : await callGemini(prompt, task.max_tokens, env, budget || 25000, think);
  } catch (e) {
    if (e && e.user) return out(e.code || 502, { error: e.user, status: e.status, detail: e.detail });
    return out(502, { error: "通信に失敗しました。接続を確認してもう一度お試しください。", detail: String(e).slice(0, 300) });
  }

  try {
    return out(200, { ok: true, data: extractJson(text) });
  } catch {
    return out(502, { error: "返答の形式が崩れていました。もう一度お試しください。", raw: String(text).slice(0, 500) });
  }
}
