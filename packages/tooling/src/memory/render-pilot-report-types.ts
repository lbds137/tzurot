/**
 * Shared record + aggregate-stat types for the render-pilot report, split out
 * of `render-pilot-metrics.ts` (aggregation logic) and consumed by both it
 * and `render-pilot-report-markdown.ts` (rendering) to keep both files under
 * their line budget.
 */

import type { RenderArm } from './render-pilot-render.js';

/** D4 summary-length classification (see `decideSummaryOutcome` in render-pilot-metrics.ts). */
export type SummaryState = 'within_soft' | 'regenerated' | 'overflow';

export interface AnswerRecord {
  arm: RenderArm;
  basis: 'assistant' | 'user';
  /** False when the judge call failed to parse — excluded from every rate denominator below. */
  judged: boolean;
  correct: boolean;
  faithful: boolean;
  unsupportedClaims: string[];
  tailTokens: number;
  /** `finishReason === 'length'` at answer time — observed independent of judging, so kept over ALL rows like tailTokens. */
  truncated: boolean;
  /** Raw reply text — used ONLY for local per-slug files, never read by the report builder. */
  reply: string;
}

export interface SummaryRecord {
  tokens: number;
  state: SummaryState;
  hasFirstPerson: boolean;
  /** True when the summarizer's response failed strict-JSON parsing and the raw body was used as-is. */
  parseFailed: boolean;
  /** Raw summary text — never read by the report builder. */
  summary: string;
}

export interface SummaryJudgeRecord {
  /** False when the judge call failed to parse — excluded from every rate denominator below. */
  judged: boolean;
  faithful: boolean;
  danglingReference: boolean;
  missingCommitments: string[];
  hasReferenced: boolean;
}

export interface FactsRecord {
  hadFacts: boolean;
  missingCommitments: string[];
}

export interface VoiceRecord {
  arm: RenderArm;
  chars: number;
  words: number;
  exclamationsPer100Words: number;
  emojiCount: number;
  thirdPersonSelfReference: boolean;
  markerHits: number;
  /** `finishReason === 'length'` — observed at reply time over ALL rows, like the other voice metrics. */
  truncated: boolean;
  /** Raw reply text — never read by the report builder. */
  reply: string;
}

export interface UsageAggregateInput {
  stage: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  reasoningBlocksStripped: number;
}

export interface ReportBuildInput {
  characterName: string;
  answers: AnswerRecord[];
  summaries: SummaryRecord[];
  summaryJudgements: SummaryJudgeRecord[];
  facts: FactsRecord[];
  voice: VoiceRecord[];
  usage: UsageAggregateInput[];
  /** Malformed question entries dropped by parseQuestionsResponse, summed across rows. */
  droppedMalformedQuestions: number;
  /** Failed model calls per stage name — a count only, deliberately carrying no error text. */
  callFailures: Record<string, number>;
}

export interface ArmAnswerStats {
  n: number;
  unjudged: number;
  correctnessRate: number;
  correctnessByBasis: { assistant: number; user: number };
  unfaithfulRate: number;
  unsupportedClaimsMean: number;
  tokensInTail: { mean: number; p95: number };
  /** Over ALL rows (judged or not) — truncation is observed at answer time. */
  truncatedRate: number;
}

export interface SummaryArmStats {
  n: number;
  unjudged: number;
  faithfulRate: number;
  danglingReferenceRateOverReferenced: number;
  danglingReferenceRateOverAll: number;
  missingCommitmentRate: number;
  stateDistribution: Record<SummaryState, number>;
  firstPersonRate: number;
  tokens: { mean: number; p95: number };
  parseFailedCount: number;
}

export interface FactsArmStats {
  n: number;
  rowsWithoutFactsShare: number;
  missingCommitmentRate: number;
}

export interface VoiceArmStats {
  n: number;
  charsMean: number;
  wordsMean: number;
  exclamationsPer100WordsMean: number;
  emojiCountMean: number;
  selfReferenceRate: number;
  markerHitsMean: number;
  truncatedRate: number;
}

export interface UsageStat {
  stage: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  calls: number;
  reasoningBlocksStripped: number;
}

export interface ReportJson {
  character: string;
  arms: Record<RenderArm, ArmAnswerStats>;
  summaryArm: SummaryArmStats;
  factsArm: FactsArmStats;
  voice: Record<RenderArm, VoiceArmStats>;
  usage: UsageStat[];
  droppedMalformedQuestions: number;
  /** Failed model calls per stage name — a count only, deliberately carrying no error text. */
  callFailures: Record<string, number>;
}
