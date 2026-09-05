/**
 * Defensive JSON parsing for model outputs, the D4 summary-length state
 * machine, voice-probe text metrics, and the aggregate report builder.
 *
 * The report builder is the boundary that must never leak memory text or
 * reply text into `summary.json`/`summary.md` — it reads only numeric/boolean
 * fields off its input records, never their text fields.
 */

import type { RenderArm } from './render-pilot-render.js';
import type {
  SummaryState,
  AnswerRecord,
  SummaryRecord,
  SummaryJudgeRecord,
  FactsRecord,
  VoiceRecord,
  UsageAggregateInput,
  ReportBuildInput,
  ArmAnswerStats,
  SummaryArmStats,
  FactsArmStats,
  VoiceArmStats,
  UsageStat,
  ReportJson,
} from './render-pilot-report-types.js';

export type {
  SummaryState,
  AnswerRecord,
  SummaryRecord,
  SummaryJudgeRecord,
  FactsRecord,
  VoiceRecord,
  UsageAggregateInput,
  ReportBuildInput,
  ReportJson,
} from './render-pilot-report-types.js';

// ---------------------------------------------------------------------------
// Defensive JSON extraction
// ---------------------------------------------------------------------------

/** Strip code fences and take the first `{...}` block from a model reply. */
export function extractJsonBlock(raw: string): string | null {
  const withoutFences = raw.replace(/```(?:json)?/gi, '').trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  return withoutFences.slice(start, end + 1);
}

function parseJsonDefensive(raw: string): Record<string, unknown> | null {
  const block = extractJsonBlock(raw);
  if (block === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(block);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export interface ParsedSummary {
  summary: string;
}

/** Parse the summarizer's `{"summary": "..."}` response. */
export function parseSummaryResponse(raw: string): ParsedSummary | null {
  const parsed = parseJsonDefensive(raw);
  if (parsed === null || typeof parsed.summary !== 'string') {
    return null;
  }
  return { summary: parsed.summary };
}

export interface ParsedQuestion {
  q: string;
  a: string;
  basis: 'assistant' | 'user';
}

/** Parse `{"questions": [...]}`; malformed entries are dropped and counted. */
export function parseQuestionsResponse(raw: string): {
  questions: ParsedQuestion[];
  dropped: number;
} {
  const parsed = parseJsonDefensive(raw);
  const rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const questions: ParsedQuestion[] = [];
  let dropped = 0;
  for (const item of rawQuestions) {
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).q === 'string' &&
      typeof (item as Record<string, unknown>).a === 'string' &&
      ((item as Record<string, unknown>).basis === 'assistant' ||
        (item as Record<string, unknown>).basis === 'user')
    ) {
      const record = item as { q: string; a: string; basis: 'assistant' | 'user' };
      questions.push(record);
    } else {
      dropped += 1;
    }
  }
  return { questions, dropped };
}

export interface ParsedAnswerJudgement {
  correct: boolean;
  faithful: boolean;
  unsupportedClaims: string[];
}

/** Parse the per-answer judge's `{"correct","faithful","unsupported_claims"}` response. */
export function parseAnswerJudgement(raw: string): ParsedAnswerJudgement | null {
  const parsed = parseJsonDefensive(raw);
  if (
    parsed === null ||
    typeof parsed.correct !== 'boolean' ||
    typeof parsed.faithful !== 'boolean'
  ) {
    return null;
  }
  return {
    correct: parsed.correct,
    faithful: parsed.faithful,
    unsupportedClaims: stringArray(parsed.unsupported_claims),
  };
}

export interface ParsedSummaryJudgement {
  faithful: boolean;
  missingCommitments: string[];
  danglingReference: boolean;
}

/** Parse render judge (a): arm-S summary vs. verbatim episode. */
export function parseSummaryJudgement(raw: string): ParsedSummaryJudgement | null {
  const parsed = parseJsonDefensive(raw);
  if (
    parsed === null ||
    typeof parsed.faithful !== 'boolean' ||
    typeof parsed.dangling_reference !== 'boolean'
  ) {
    return null;
  }
  return {
    faithful: parsed.faithful,
    missingCommitments: stringArray(parsed.missing_commitments),
    danglingReference: parsed.dangling_reference,
  };
}

export interface ParsedFactsJudgement {
  missingCommitments: string[];
}

/** Parse render judge (b): arm-F linked-facts set vs. verbatim episode. */
export function parseFactsJudgement(raw: string): ParsedFactsJudgement | null {
  const parsed = parseJsonDefensive(raw);
  if (parsed === null) {
    return null;
  }
  return { missingCommitments: stringArray(parsed.missing_commitments) };
}

// ---------------------------------------------------------------------------
// D4 summary-length state machine
// ---------------------------------------------------------------------------

/** ≤60 tokens accepts without a retry; the retry threshold. */
export const SUMMARY_SOFT_CAP_TOKENS = 60;
/** Hard cap: a retry result still over this is flagged `overflow`, never truncated. */
export const SUMMARY_HARD_CAP_TOKENS = 100;

export interface SummaryCandidate {
  text: string;
  tokens: number;
}

/**
 * Decide the D4 length state from a first summarizer call and an optional
 * retry. Never slices or truncates either candidate's text — an over-cap
 * result is flagged `overflow` and kept whole, because a truncated summary
 * can cut a fact mid-sentence.
 */
export function decideSummaryOutcome(
  first: SummaryCandidate,
  retry: SummaryCandidate | null
): SummaryCandidate & { state: SummaryState } {
  if (first.tokens <= SUMMARY_SOFT_CAP_TOKENS) {
    return { ...first, state: 'within_soft' };
  }
  const chosen = retry !== null && retry.tokens <= first.tokens ? retry : first;
  return {
    ...chosen,
    state: chosen.tokens <= SUMMARY_HARD_CAP_TOKENS ? 'regenerated' : 'overflow',
  };
}

/** Approximate first-person detector: `\b(I|I'm|I've|me|my)\b` outside double-quoted spans. */
export function hasFirstPerson(text: string): boolean {
  const withoutQuotes = text.replace(/"[^"]*"/g, '');
  return /\b(I'll|I'd|I'm|I've|I|me|my|mine|myself)\b/.test(withoutQuotes);
}

// ---------------------------------------------------------------------------
// Voice-probe text metrics (approximate, documented as such)
// ---------------------------------------------------------------------------

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export function exclamationsPer100Words(text: string): number {
  const words = countWords(text);
  if (words === 0) {
    return 0;
  }
  const exclamations = (text.match(/!/g) ?? []).length;
  return (exclamations / words) * 100;
}

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

export function countEmoji(text: string): number {
  return (text.match(EMOJI_RE) ?? []).length;
}

/**
 * Approximate third-person self-reference detector: `<displayName> <verb>`
 * (is/was/has/had/says/said/thinks/thought/will/would/does/did/feels/felt),
 * evaluated with double-quoted spans removed first so a quoted line the
 * character is reading back doesn't count as their own self-reference.
 */
export function hasThirdPersonSelfReference(text: string, displayName: string): boolean {
  const withoutQuotes = text.replace(/"[^"]*"/g, '');
  const escapedName = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `${escapedName} (is|was|has|had|says|said|thinks|thought|will|would|does|did|feels|felt)\\b`,
    'i'
  );
  return re.test(withoutQuotes);
}

export function countMarkerHits(text: string, markers: string[]): number {
  const lower = text.toLowerCase();
  return markers.reduce(
    (count, marker) => count + (lower.includes(marker.toLowerCase()) ? 1 : 0),
    0
  );
}

// ---------------------------------------------------------------------------
// Aggregate report builder — reads only numeric/boolean fields, never text
// ---------------------------------------------------------------------------
// Record + stat types live in render-pilot-report-types.ts (imported above)
// to keep this file and render-pilot-report-markdown.ts both under budget.

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function p95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))];
}

const ARMS: RenderArm[] = ['V', 'F', 'S'];

function armAnswerStats(records: AnswerRecord[], arm: RenderArm): ArmAnswerStats {
  const rows = records.filter(r => r.arm === arm);
  const judgedRows = rows.filter(r => r.judged);
  const byBasis = (basis: 'assistant' | 'user'): number => {
    const subset = judgedRows.filter(r => r.basis === basis);
    return subset.length === 0 ? 0 : subset.filter(r => r.correct).length / subset.length;
  };
  return {
    n: rows.length,
    unjudged: rows.length - judgedRows.length,
    correctnessRate:
      judgedRows.length === 0 ? 0 : judgedRows.filter(r => r.correct).length / judgedRows.length,
    correctnessByBasis: { assistant: byBasis('assistant'), user: byBasis('user') },
    unfaithfulRate:
      judgedRows.length === 0 ? 0 : judgedRows.filter(r => !r.faithful).length / judgedRows.length,
    unsupportedClaimsMean: mean(judgedRows.map(r => r.unsupportedClaims.length)),
    // Tail-token count and truncation are both measured at answer time,
    // independent of whether the judge later parsed — kept over every row,
    // judged or not.
    tokensInTail: {
      mean: mean(rows.map(r => r.tailTokens)),
      p95: p95(rows.map(r => r.tailTokens)),
    },
    truncatedRate: rows.length === 0 ? 0 : rows.filter(r => r.truncated).length / rows.length,
  };
}

function summaryArmStats(
  summaries: SummaryRecord[],
  judgements: SummaryJudgeRecord[]
): SummaryArmStats {
  const judged = judgements.filter(j => j.judged);
  const withReferenced = judged.filter(j => j.hasReferenced);
  const stateDistribution: Record<SummaryState, number> = {
    within_soft: 0,
    regenerated: 0,
    overflow: 0,
  };
  for (const s of summaries) {
    stateDistribution[s.state] += 1;
  }
  return {
    n: summaries.length,
    unjudged: judgements.length - judged.length,
    faithfulRate: judged.length === 0 ? 0 : judged.filter(j => j.faithful).length / judged.length,
    danglingReferenceRateOverReferenced:
      withReferenced.length === 0
        ? 0
        : withReferenced.filter(j => j.danglingReference).length / withReferenced.length,
    danglingReferenceRateOverAll:
      judged.length === 0 ? 0 : judged.filter(j => j.danglingReference).length / judged.length,
    missingCommitmentRate:
      judged.length === 0
        ? 0
        : judged.filter(j => j.missingCommitments.length > 0).length / judged.length,
    stateDistribution,
    firstPersonRate:
      summaries.length === 0
        ? 0
        : summaries.filter(s => s.hasFirstPerson).length / summaries.length,
    tokens: { mean: mean(summaries.map(s => s.tokens)), p95: p95(summaries.map(s => s.tokens)) },
    parseFailedCount: summaries.filter(s => s.parseFailed).length,
  };
}

function factsArmStats(facts: FactsRecord[]): FactsArmStats {
  return {
    n: facts.length,
    rowsWithoutFactsShare:
      facts.length === 0 ? 0 : facts.filter(f => !f.hadFacts).length / facts.length,
    missingCommitmentRate:
      facts.length === 0
        ? 0
        : facts.filter(f => f.missingCommitments.length > 0).length / facts.length,
  };
}

function voiceArmStats(records: VoiceRecord[], arm: RenderArm): VoiceArmStats {
  const rows = records.filter(r => r.arm === arm);
  return {
    n: rows.length,
    charsMean: mean(rows.map(r => r.chars)),
    wordsMean: mean(rows.map(r => r.words)),
    exclamationsPer100WordsMean: mean(rows.map(r => r.exclamationsPer100Words)),
    emojiCountMean: mean(rows.map(r => r.emojiCount)),
    selfReferenceRate:
      rows.length === 0 ? 0 : rows.filter(r => r.thirdPersonSelfReference).length / rows.length,
    markerHitsMean: mean(rows.map(r => r.markerHits)),
    truncatedRate: rows.length === 0 ? 0 : rows.filter(r => r.truncated).length / rows.length,
  };
}

function usageStats(records: UsageAggregateInput[]): UsageStat[] {
  const byKey = new Map<string, UsageStat>();
  for (const record of records) {
    const key = `${record.stage}::${record.model}`;
    const existing = byKey.get(key) ?? {
      stage: record.stage,
      model: record.model,
      promptTokens: 0,
      completionTokens: 0,
      calls: 0,
      reasoningBlocksStripped: 0,
    };
    existing.promptTokens += record.promptTokens;
    existing.completionTokens += record.completionTokens;
    existing.calls += 1;
    existing.reasoningBlocksStripped += record.reasoningBlocksStripped;
    byKey.set(key, existing);
  }
  return [...byKey.values()];
}

/**
 * Build the aggregate report object. Deliberately reads only numeric/boolean
 * fields off its inputs — `reply`/`summary` text fields exist on the input
 * types for the per-slug local files, but this function never touches them.
 */
export function buildReportJson(input: ReportBuildInput): ReportJson {
  return {
    character: input.characterName,
    arms: Object.fromEntries(ARMS.map(arm => [arm, armAnswerStats(input.answers, arm)])) as Record<
      RenderArm,
      ArmAnswerStats
    >,
    summaryArm: summaryArmStats(input.summaries, input.summaryJudgements),
    factsArm: factsArmStats(input.facts),
    voice: Object.fromEntries(ARMS.map(arm => [arm, voiceArmStats(input.voice, arm)])) as Record<
      RenderArm,
      VoiceArmStats
    >,
    usage: usageStats(input.usage),
    droppedMalformedQuestions: input.droppedMalformedQuestions,
  };
}

// Markdown rendering (the aggregate report + the LOCAL-ONLY spot-check file)
// lives in render-pilot-report-markdown.ts to keep this file under budget.
