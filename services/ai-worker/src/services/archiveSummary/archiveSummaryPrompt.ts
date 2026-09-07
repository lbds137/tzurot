/**
 * Memory-archive summarizer prompt + response contracts (slice B1, write side).
 *
 * Ported in spirit from `packages/tooling/src/memory/render-pilot-prompts.ts`
 * (the SUMMARIZER_SYSTEM_PROMPT arm), with the length line tightened to the
 * pilot's re-measured target and two additional worked examples covering
 * referenced content. This module keeps its OWN copy — ai-worker must never
 * import from `packages/tooling`.
 *
 * `invokeSystemModel` takes a single prompt string, so every builder here
 * joins the system rules and the user-facing message with a blank line — the
 * same single-prompt seam `buildRosterBlurbPrompt` uses.
 */

import { z } from 'zod';

/** Input to every summarizer-family prompt builder: one exchange's fields. */
export interface SummarizerMessageInput {
  displayName: string;
  subjectName: string;
  userText: string;
  assistantText: string;
  referenced: string | null;
}

const SUMMARIZER_SYSTEM_PROMPT = `You summarize one past exchange between a user and a character, in the third person, for the character's own memory archive.

Rules:
- Write in third person. Name the character by their display name and the user by their subject name — never "I" or "you".
- Faithfulness: assert nothing that is not in the source text. Do not infer motives, feelings, or facts beyond what is stated.
- Preserve every speech act: commitments, promises, decisions, advice given, questions asked, and forms of address. A nickname the character used or agreed to is a fact to keep.
- Discard prosody, formatting, emoji, first-person voice, and style — keep only what was said and decided.
- The source may include a block starting with "[Referenced content: ...]" — this is content the character was reacting to. Anything the character reacted to must be named CONCRETELY in the summary ("agreed with the plan" is wrong; name the plan). Never mention the block itself, its label, or that it was "referenced".
- Length: one to three sentences, at most 60 words total.

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

Output: {"summary": "Jules finished the marathon they had been training for, in 4 hours 12 minutes, having earlier worried about their knee; Nova congratulated them."}

Example 3:
Character: Nova
User: Jules

Jules: you can just call me Jay, everyone does
Nova: Jay it is, then.

Output: {"summary": "Jules told Nova to call them Jay instead, and Nova agreed to use that name going forward."}

Example 4:
Character: Nova
User: Jules

Jules: yeah let's do it, Saturday morning works
Nova: Great — I'll meet you at the trailhead at 8.

[Referenced content: Jules proposed a plan to hike the ridge trail this weekend if the weather held.]

Output: {"summary": "Jules confirmed the plan to hike the ridge trail on Saturday morning, and Nova agreed to meet at the trailhead at 8."}

Example 5:
Character: Nova
User: Jules

Jules: still on for that, don't worry
Nova: Good, I was starting to wonder.

[Referenced content: Jules promised two weeks ago to send Nova the draft of their resignation letter for feedback.]

Output: {"summary": "Jules reaffirmed the earlier promise to send Nova the draft resignation letter for feedback, which Nova had begun to doubt would happen."}`;

/** The two speaker lines of one exchange, plus the referenced-content block when present. */
function verbatimExchangeLines(input: SummarizerMessageInput): string[] {
  const lines = [
    `${input.subjectName}: ${input.userText}`,
    `${input.displayName}: ${input.assistantText}`,
  ];
  if (input.referenced !== null) {
    lines.push('', `[Referenced content: ${input.referenced}]`);
  }
  return lines;
}

function buildUserMessage(input: SummarizerMessageInput): string {
  const lines = [
    `Character: ${input.displayName}`,
    `User: ${input.subjectName}`,
    '',
    ...verbatimExchangeLines(input),
  ];
  return lines.join('\n');
}

/** The initial summarizer call: system rules + the verbatim exchange. */
export function buildSummarizerPrompt(input: SummarizerMessageInput): string {
  return `${SUMMARIZER_SYSTEM_PROMPT}\n\n${buildUserMessage(input)}`;
}

/**
 * The single regeneration call: the same rules and exchange, plus the
 * rejected summary and the concrete feedback that caused rejection, ending
 * with a fixed instruction so every regeneration converges the same way.
 */
export function buildRegeneratePrompt(
  input: SummarizerMessageInput,
  previousSummary: string,
  feedback: string[]
): string {
  const feedbackBlock = [
    '',
    `Previous summary (rejected): ${previousSummary}`,
    'Problems:',
    ...feedback.map(line => `- ${line}`),
    '',
    'Write a new summary. Tighter, keep every commitment and every name, write in third person.',
  ].join('\n');
  return `${SUMMARIZER_SYSTEM_PROMPT}\n\n${buildUserMessage(input)}${feedbackBlock}`;
}

export const REFERENT_CHECK_SYSTEM_PROMPT = `You are checking a third-person summary of a past exchange against the verbatim exchange it summarizes (including any "[Referenced content: ...]" block).

List anything the summary refers to that a reader of the SUMMARY ALONE — without the verbatim exchange — could not identify: a vague "it", "the plan", "that", or similar stand-in for something the summary itself never names.

Output STRICT JSON only, of the exact shape {"dangling": ["...", ...]}. Empty array if nothing dangles. No prose before or after the JSON.`;

/** The referent-check call: the verbatim exchange plus the candidate summary. */
export function buildReferentCheckPrompt(input: SummarizerMessageInput, summary: string): string {
  const lines = ['Verbatim exchange:', ...verbatimExchangeLines(input), '', `Summary: ${summary}`];
  return `${REFERENT_CHECK_SYSTEM_PROMPT}\n\n${lines.join('\n')}`;
}

export const summaryResponseSchema = z.object({ summary: z.string().trim().min(1) });
export const referentCheckResponseSchema = z.object({ dangling: z.array(z.string()) });
