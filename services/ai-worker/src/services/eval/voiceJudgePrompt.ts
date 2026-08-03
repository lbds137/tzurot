/**
 * LLM-judge prompt + verdict handling for the voice-consistency harness.
 *
 * The judge evaluates OUTPUTS against the persona definition — it never sees
 * which assembly produced what (blind labels, and each pair is judged twice
 * with positions swapped; a preference counts only when both orders agree).
 * The rubric scores fidelity to THIS persona, explicitly not quality: length,
 * eloquence, and helpfulness must not win points.
 */

import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';

/** One judge call's parsed output. Labels are the CALL's positions (1 = shown first). */
export interface JudgeVerdict {
  winner: '1' | '2' | 'tie';
  /** 0 = negligible, 1 = clear, 2 = severe. */
  margin: number;
  violations: {
    response: '1' | '2';
    kind: string;
    quote: string;
  }[];
  rationale: string;
}

/** A swap-resolved pair verdict in the pair's CANONICAL (unswapped) orientation. */
export interface ResolvedVerdict {
  winner: 'left' | 'right' | 'tie';
  /** True when both orders agreed on a non-tie winner. */
  consistent: boolean;
  violations: {
    side: 'left' | 'right';
    kind: string;
    quote: string;
  }[];
}

/** The persona-definition card the judge scores against (never the assembled prompts). */
export function buildPersonaCard(personality: LoadedPersonality): string {
  const fields: [string, string | undefined][] = [
    ['Name', personality.name],
    ['Character', personality.characterInfo],
    ['Traits', personality.personalityTraits],
    ['Tone', personality.personalityTone],
    ['Likes', personality.personalityLikes],
    ['Dislikes', personality.personalityDislikes],
    ['Conversational goals', personality.conversationalGoals],
    ['Example exchanges', personality.conversationalExamples],
  ];
  const card = fields
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1].length > 0)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
  // The protocol carries formatting/behavior rules in either storage format;
  // include it raw — the judge reads it as a rule sheet, not as XML to obey.
  const protocol =
    personality.systemPrompt !== undefined && personality.systemPrompt.length > 0
      ? `\nBehavior/formatting rules (verbatim):\n${personality.systemPrompt}`
      : '';
  return `${card}${protocol}`;
}

export interface JudgePromptInputs {
  personaCard: string;
  /** The last few REAL turns before the probe (register anchor), oldest first. */
  recentTurns: { speaker: string; text: string }[];
  /** The user turn both responses reply to. */
  triggerText: string;
  response1: string;
  response2: string;
}

export function buildJudgePrompt(inputs: JudgePromptInputs): string {
  const turns = inputs.recentTurns.map(turn => `${turn.speaker}: ${turn.text}`).join('\n');
  return `You are judging VOICE CONSISTENCY for a roleplay character. Two candidate responses to the same message are shown. Your job: which response is more faithful to THIS character's established voice — or are they equivalent?

CHARACTER DEFINITION
${inputs.personaCard}

RECENT CONVERSATION (real, for register anchoring — the character's own lines here show the voice to match)
${turns}

MESSAGE BEING REPLIED TO
${inputs.triggerText}

RESPONSE 1
${inputs.response1}

RESPONSE 2
${inputs.response2}

JUDGING RULES
- Score FIDELITY, not quality: do NOT reward length, eloquence, helpfulness, or creativity. A shorter plainer response that sounds like the character beats a beautiful one that doesn't.
- Weigh: diction/register match to the definition and the character's own recent lines; compliance with the stated formatting/behavior rules; continuity with the conversation; turn discipline (one turn, never speaking for other participants); repetition or degeneration (looping phrases, template artifacts).
- "tie" is the correct answer when the differences are within normal sampling variation. Do not force a winner.
- A VIOLATION is a hard break: out-of-character identity slip, speaking for another participant, leaked markup/scaffolding (XML tags, speaker labels), or a formatting-rule breach. Quote the exact offending text.

Respond with ONLY a JSON object, no prose, no code fence:
{"winner": "1" | "2" | "tie", "margin": 0 | 1 | 2, "violations": [{"response": "1" | "2", "kind": "a short kind label", "quote": "the exact offending text"}], "rationale": "one or two sentences"}`;
}

/** Parse the judge's raw completion into a verdict; throws on malformed output. */
export function parseJudgeVerdict(raw: string): JudgeVerdict {
  // Tolerate a fenced or prose-wrapped reply by extracting the outermost object.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`Judge output contains no JSON object: ${raw.slice(0, 200)}`);
  }
  const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Judge output is not a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  const winner = obj.winner;
  if (winner !== '1' && winner !== '2' && winner !== 'tie') {
    throw new Error(`Judge winner is invalid: ${String(winner)}`);
  }
  const margin = typeof obj.margin === 'number' && obj.margin >= 0 ? obj.margin : 0;
  const violationsRaw = Array.isArray(obj.violations) ? obj.violations : [];
  const violations = violationsRaw
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null
    )
    .filter(entry => entry.response === '1' || entry.response === '2')
    .map(entry => ({
      response: entry.response as '1' | '2',
      kind: typeof entry.kind === 'string' ? entry.kind : 'unspecified',
      quote: typeof entry.quote === 'string' ? entry.quote : '',
    }));
  const rationale = typeof obj.rationale === 'string' ? obj.rationale : '';
  return { winner, margin, violations, rationale };
}

/**
 * Resolve the two position-swapped calls into one canonical verdict.
 *
 * `forward` showed (left as Response 1, right as Response 2); `swapped`
 * showed the reverse. A side wins only when BOTH orders picked it; anything
 * else — disagreement, or either order calling a tie — resolves to tie.
 * Violations from both calls are mapped back to canonical sides and deduped.
 */
export function resolveSwappedVerdicts(
  forward: JudgeVerdict,
  swapped: JudgeVerdict
): ResolvedVerdict {
  const forwardPick = forward.winner === '1' ? 'left' : forward.winner === '2' ? 'right' : 'tie';
  const swappedPick = swapped.winner === '1' ? 'right' : swapped.winner === '2' ? 'left' : 'tie';
  const agreed = forwardPick !== 'tie' && forwardPick === swappedPick;

  const seen = new Set<string>();
  const violations: ResolvedVerdict['violations'] = [];
  const collect = (verdict: JudgeVerdict, map: Record<'1' | '2', 'left' | 'right'>): void => {
    for (const violation of verdict.violations) {
      const side = map[violation.response];
      const key = `${side}:${violation.kind}:${violation.quote}`;
      if (!seen.has(key)) {
        seen.add(key);
        violations.push({ side, kind: violation.kind, quote: violation.quote });
      }
    }
  };
  collect(forward, { '1': 'left', '2': 'right' });
  collect(swapped, { '1': 'right', '2': 'left' });

  return {
    winner: agreed ? forwardPick : 'tie',
    consistent: agreed,
    violations,
  };
}
