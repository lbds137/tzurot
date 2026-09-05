/**
 * Render-pilot prompt constants and user-message builders.
 *
 * Every model call the pilot makes (summarizer, question generator, answer
 * judge, render judges) has its system prompt and message-assembly logic
 * here so the orchestration stage in `render-pilot.ts` stays thin.
 */

/** D4 contract: the arm-S summarizer system prompt. */
export const SUMMARIZER_SYSTEM_PROMPT = `You summarize one past exchange between a user and a character, in the third person, for the character's own memory archive.

Rules:
- Write in third person. Name the character by their display name and the user by their subject name — never "I" or "you".
- Faithfulness: assert nothing that is not in the source text. Do not infer motives, feelings, or facts beyond what is stated.
- Preserve every speech act: commitments, promises, decisions, advice given, questions asked, and forms of address. A nickname the character used or agreed to is a fact to keep.
- Discard prosody, formatting, emoji, first-person voice, and style — keep only what was said and decided.
- The source may include a block starting with "[Referenced content: ...]" — this is content the character was reacting to. Anything the character reacted to must be named CONCRETELY in the summary ("agreed with the plan" is wrong; name the plan). Never mention the block itself, its label, or that it was "referenced".
- Length: one to three sentences, at most 45 words total.

Output STRICT JSON only, of the exact shape {"summary": "..."}. No prose before or after the JSON.

Example 1:
Character: Nova
User: Jules

Jules: can you remind me to call the vet tomorrow at 9?
Nova: Got it — I'll bring it up first thing tomorrow morning.

Output: {"summary": "Jules asked Nova to remind them to call the vet at 9am the next day; Nova agreed to bring it up first thing that morning."}

Example 2:
Character: Nova
User: Jules

Jules: I finally finished the marathon! 4 hours 12 minutes, can you believe it
Nova: That's incredible, congratulations! All that training paid off.

[Referenced content: Jules said last month they were training for a marathon and worried about their knee.]

Output: {"summary": "Jules finished a marathon in 4 hours 12 minutes, resolving the knee worry they had raised while training for it; Nova congratulated them."}

Example 3:
Character: Nova
User: Jules

Jules: you can just call me Jay, everyone does
Nova: Jay it is, then.

Output: {"summary": "Jules told Nova to call them Jay instead, and Nova agreed to use that name going forward."}`;

/** Options for {@link buildSummarizerUserMessage}. */
export interface SummarizerMessageInput {
  displayName: string;
  subjectName: string;
  userText: string;
  assistantText: string;
  referenced: string | null;
}

/** User message for one summarizer call. */
export function buildSummarizerUserMessage(input: SummarizerMessageInput): string {
  const lines = [
    `Character: ${input.displayName}`,
    `User: ${input.subjectName}`,
    '',
    `${input.subjectName}: ${input.userText}`,
    `${input.displayName}: ${input.assistantText}`,
  ];
  if (input.referenced !== null) {
    lines.push('', `[Referenced content: ${input.referenced}]`);
  }
  return lines.join('\n');
}

/** Retry message for a summary over the soft cap — shows the model its own over-length draft so "tighter" has a referent. */
export function buildTightenMessage(previousSummary: string): string {
  return `Previous summary (over the length cap):\n${previousSummary}\n\nTighter. Keep every commitment and every name.`;
}

/** The question-generator system prompt (run by the judge-model family). */
export const QUESTION_SYSTEM_PROMPT = `Given a verbatim past exchange between a user and a character, write questions a user could plausibly ask the character LATER, about that exchange.

For each question, give a short reference answer drawn only from the exchange, and a "basis" tag:
- "assistant" — the answer lies in what the character said, decided, promised, or advised.
- "user" — the answer lies in what the user said.

When both sides of the exchange carry content that could be asked about, produce one question of each basis. When only one side does, tag honestly rather than forcing a pair.

Output STRICT JSON only, of the exact shape {"questions": [{"q": "...", "a": "...", "basis": "assistant"|"user"}, ...]}. No prose before or after the JSON.`;

/** Options for {@link buildQuestionUserMessage}. */
export interface QuestionMessageInput {
  displayName: string;
  subjectName: string;
  userText: string;
  assistantText: string;
  referenced: string | null;
  questionsPerRow: number;
}

export function buildQuestionUserMessage(input: QuestionMessageInput): string {
  const lines = [
    `Character: ${input.displayName}`,
    `User: ${input.subjectName}`,
    `Questions to produce: ${String(input.questionsPerRow)}`,
    '',
    `${input.subjectName}: ${input.userText}`,
    `${input.displayName}: ${input.assistantText}`,
  ];
  if (input.referenced !== null) {
    lines.push('', `[Referenced content: ${input.referenced}]`);
  }
  return lines.join('\n');
}

/** The per-answer judge system prompt. */
export const JUDGE_ANSWER_SYSTEM_PROMPT = `You are grading a character's reply to a question about a past exchange, against the verbatim record of that exchange.

Given the verbatim exchange, the question asked, a reference answer, and the character's actual reply, decide:
- "correct": does the reply answer the question consistently with the reference answer?
- "faithful": does the reply assert nothing about the past exchange that the verbatim exchange does not support? (A reply may be unfaithful even while getting the gist right, by adding invented specifics.)
- "unsupported_claims": list any specific claims in the reply about the past exchange that are not supported by the verbatim exchange. Empty array if none.

Output STRICT JSON only: {"correct": bool, "faithful": bool, "unsupported_claims": [string, ...]}. No prose before or after the JSON.`;

/** Options for {@link buildJudgeAnswerUserMessage}. */
export interface JudgeAnswerMessageInput {
  subjectName: string;
  displayName: string;
  userText: string;
  assistantText: string;
  referenced: string | null;
  question: string;
  referenceAnswer: string;
  reply: string;
}

export function buildJudgeAnswerUserMessage(input: JudgeAnswerMessageInput): string {
  const lines = [
    `Verbatim exchange:`,
    `${input.subjectName}: ${input.userText}`,
    `${input.displayName}: ${input.assistantText}`,
  ];
  if (input.referenced !== null) {
    lines.push('', `[Referenced content: ${input.referenced}]`);
  }
  lines.push(
    '',
    `Question asked: ${input.question}`,
    `Reference answer: ${input.referenceAnswer}`,
    `Character's reply: ${input.reply}`
  );
  return lines.join('\n');
}

/** Render judge (a): arm-S summary vs. the verbatim episode. */
export const JUDGE_SUMMARY_SYSTEM_PROMPT = `You are grading a third-person summary of a past exchange against the verbatim exchange it summarizes.

Decide:
- "faithful": does the summary assert nothing the verbatim exchange does not support?
- "missing_commitments": list any commitment, promise, decision, advice, or form-of-address change present in the verbatim exchange but absent from the summary. Empty array if none.
- "dangling_reference": true if the summary refers to something (a plan, an event, a prior topic) that a reader of the summary ALONE — without the verbatim exchange — could not identify.

Output STRICT JSON only: {"faithful": bool, "missing_commitments": [string, ...], "dangling_reference": bool}. No prose before or after the JSON.`;

/** Options for {@link buildJudgeSummaryUserMessage}. */
export interface JudgeSummaryMessageInput {
  subjectName: string;
  displayName: string;
  userText: string;
  assistantText: string;
  referenced: string | null;
  summary: string;
}

export function buildJudgeSummaryUserMessage(input: JudgeSummaryMessageInput): string {
  const lines = [
    'Verbatim exchange:',
    `${input.subjectName}: ${input.userText}`,
    `${input.displayName}: ${input.assistantText}`,
  ];
  if (input.referenced !== null) {
    lines.push('', `[Referenced content: ${input.referenced}]`);
  }
  lines.push('', `Summary: ${input.summary}`);
  return lines.join('\n');
}

/** Render judge (b): arm-F linked-facts set vs. the verbatim episode. */
export const JUDGE_FACTS_SYSTEM_PROMPT = `You are grading a set of extracted facts about a past exchange against the verbatim exchange they were extracted from.

Decide:
- "missing_commitments": list any commitment, promise, decision, or advice the character gave in the verbatim exchange that NONE of the listed facts record. Empty array if none. If no facts are listed, list every such commitment in the exchange.

Output STRICT JSON only: {"missing_commitments": [string, ...]}. No prose before or after the JSON.`;

/** Options for {@link buildJudgeFactsUserMessage}. */
export interface JudgeFactsMessageInput {
  subjectName: string;
  displayName: string;
  userText: string;
  assistantText: string;
  referenced: string | null;
  factStatements: string[];
}

export function buildJudgeFactsUserMessage(input: JudgeFactsMessageInput): string {
  const lines = [
    'Verbatim exchange:',
    `${input.subjectName}: ${input.userText}`,
    `${input.displayName}: ${input.assistantText}`,
  ];
  if (input.referenced !== null) {
    lines.push('', `[Referenced content: ${input.referenced}]`);
  }
  lines.push(
    '',
    input.factStatements.length > 0
      ? `Facts on file:\n${input.factStatements.map(s => `- ${s}`).join('\n')}`
      : 'Facts on file: (none)'
  );
  return lines.join('\n');
}

/** Default trigger set for the voice-probe stage, used when `--triggers-file` is absent. */
export const DEFAULT_VOICE_TRIGGERS: readonly string[] = [
  'hey, just checking in — how have you been?',
  "quick question: what's the best way to get started with something you've never done before?",
  "I've got a decision to make and I'm torn. Any advice?",
  'lol ok',
  "remember when you said that thing about always showing up? I've been thinking about it.",
];
