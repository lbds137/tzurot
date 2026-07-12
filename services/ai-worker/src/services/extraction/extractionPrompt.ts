/**
 * Fact-extraction prompt + response contract (memory Phase 2 §3.2)
 *
 * One structured-output call per batch. Design constraints, all council-ruled:
 *  - Existing facts are injected as a NUMBERED list; the model names
 *    supersession targets by INDEX into that list (never by id or text —
 *    an integer index into visible text is the most hallucination-resistant
 *    reference an LLM can produce; the index→id mapping stays server-side).
 *  - Event-not-fact bias with a fact floor: extract atomic DURABLE statements,
 *    not scene narration (episodes already capture the scene verbatim).
 *  - fail-to-skip: the caller parses with safeParse and writes NOTHING on a
 *    malformed response. This schema is the single source of that contract.
 */

import { z } from 'zod';
import type { FactForContext } from './FactStore.js';

/** One extracted fact as the model must return it. */
export const extractedFactSchema = z.object({
  /** Atomic durable statement, third person, self-contained. */
  statement: z.string().trim().min(1).max(500),
  /** Flat entity tags, "kind:name" ("user:alice", "pet:miso", "topic:cooking"). */
  entityTags: z.array(z.string().trim().min(1).max(100)).max(10),
  /** Importance 0..1 (durable identity-level ≈ 0.8+, passing preference ≈ 0.3). */
  salience: z.number().min(0).max(1),
  /** Index into the injected known-facts list this fact supersedes, or null. */
  supersedesIndex: z.number().int().min(0).nullable(),
});

export const extractionResponseSchema = z.object({
  facts: z.array(extractedFactSchema).max(10),
});

export type ExtractedFact = z.infer<typeof extractedFactSchema>;

/**
 * Build the extraction prompt.
 *
 * @param episodes verbatim interaction texts, oldest first
 * @param knownFacts recent active same-scope facts (the supersession context)
 * @param isFictionScope whether this scope is in-character canon (R7 flag)
 */
export function buildExtractionPrompt(
  episodes: string[],
  knownFacts: FactForContext[],
  isFictionScope: boolean
): string {
  const factsBlock =
    knownFacts.length === 0
      ? '(none known yet)'
      : knownFacts.map((f, i) => `[${i}] ${f.statement}`).join('\n');

  const episodesBlock = episodes.map(e => `---\n${e}`).join('\n');

  return `You extract durable facts from roleplay conversation excerpts.

Existing known facts (may be outdated; numbered for reference):
${factsBlock}

Conversation excerpts (oldest first; "{user}" and "{assistant}" are placeholder names):
${episodesBlock}
---

Extract NEW durable facts from the excerpts. Rules:
- A DURABLE fact is atomic, self-contained, third-person, and would still be true and worth knowing months from now: names, relationships, occupation, location, preferences, allergies, lasting decisions, stable world/canon details.
- Name the fact's subject exactly as shown in the excerpts ("Alice lives in Denver", "{user} is a pastor" — keep a literal "{user}" placeholder verbatim). NEVER write "the user" or "the speaker" as a subject: facts are read back in later conversations with multiple people present, where "the user" no longer identifies anyone.
- ONE fact per statement. If a sentence carries two facts ("has a severe peanut allergy AND learned it in childhood", "fears water AND survived a shipwreck"), split it into separate statements — do not join them with "and".
- Apply the durability test — "will this still be true and relevant in six months?" If no, do NOT extract it. In particular, do NOT extract:
  - transient states: current mood, tiredness, hunger, an illness or headache today
  - time-bound plans or upcoming events: a trip next week, a deadline tomorrow, tonight's dinner, an appointment
  - one-off actions and scene/setting narration: walking into a room, the furniture, the weather right now
  - hypotheticals, wishes, or what-ifs: what someone would do if they won the lottery
  - facts about the assistant or the AI itself
  A past event counts as durable ONLY if it leaves a lasting truth ("moved to Denver", "had knee surgery last year"), not if it merely describes a passing moment.
- Do NOT restate an existing known fact unless the excerpts CHANGE it.
- If a new fact updates or contradicts a numbered known fact, set "supersedesIndex" to that fact's number; otherwise null.
- ${isFictionScope ? 'This is an in-character fiction scope: extract in-story canon facts.' : 'Extract facts about the real user and their world; ignore in-story fiction.'}
- salience: 0..1 — how identity-defining/durable the fact is.
- entityTags: short "kind:name" tags for who/what the fact is about.
- If the excerpts contain no durable facts, return an empty list. Extracting nothing is always safer than inventing.

Respond with ONLY a JSON object of this exact shape:
{"facts": [{"statement": "...", "entityTags": ["user:alice"], "salience": 0.7, "supersedesIndex": null}]}`;
}

/**
 * Unwrap a model response that arrives fenced as a markdown code block.
 *
 * Anthropic-family models via OpenRouter do not honor OpenAI-style
 * response_format json_object and commonly return "```json\n{...}\n```" —
 * without this unwrap, production fail-to-skip would silently skip EVERY
 * batch (caught by the first real-model eval run, not by unit tests, whose
 * mocks return clean JSON).
 */
export function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }
  const firstNewline = trimmed.indexOf('\n');
  const closingFence = trimmed.lastIndexOf('```');
  if (firstNewline === -1 || closingFence <= firstNewline) {
    return trimmed; // open-only fence: malformed stays malformed (fail-to-skip)
  }
  return trimmed.slice(firstNewline + 1, closingFence).trim();
}
