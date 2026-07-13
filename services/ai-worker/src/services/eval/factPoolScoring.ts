/**
 * Fact-pool scoring: the committed half of the memory-1b fact eval bench.
 *
 * The episode pool (`qrelsReconciliation.ts` / `poolScoring.ts`) persists only
 * per-arm RANKS, so it can simulate rank-fusion policies but not continuous
 * composite scores — the raw signals were discarded at pool time. The fact pool
 * fixes that by persisting every §3.4 scoring input per candidate (raw
 * similarity, salience, tier, validFrom), which makes ANY deterministic
 * weight vector retroactively simulable against one judging pass: a policy
 * scores the persisted candidates, the scores become a derived rank arm, and
 * the existing `poolScoring` instruments (recall@K / MRR / paired flips)
 * consume it unchanged via `reconcile`.
 *
 * `FactPooledCandidate` structurally extends `PooledCandidate` (corpusId = the
 * fact id, createdAtMs = validFrom, contentPreview = statement preview) so the
 * qrels reconciliation and every scorer work on fact pools without adaptation.
 *
 * Like its episode siblings: the pooling RUNNER and the judged qrels are
 * local-only (sensitive corpus); this scoring math is committed and CI-tested.
 */

import type { GoldenPool, PooledCandidate } from './qrelsReconciliation.js';

/** One pooled fact candidate: the shared pool shape + every §3.4 scoring input. */
export interface FactPooledCandidate extends PooledCandidate {
  /** 1 − cosine distance against the golden's production search query, at pool time. */
  similarity: number;
  /** Extraction-model-assigned importance, 0..1 (`memory_facts.salience`). */
  salience: number;
  /** 'observed' | 'corrected' | 'inferred' (`memory_facts.tier`). */
  tier: string;
  /** Entity tags as stored — the wrong-entity feedback item reads these on the sheet. */
  entityTags: string[];
}

/** One golden's fact pool. `createdAtMs` on candidates is the fact's validFrom. */
export interface FactGoldenPool extends GoldenPool {
  candidates: FactPooledCandidate[];
  /** The golden's channel — pairs sharing a channel feed the repetition metric. */
  channelId: string;
  /** The production-constructed search query the similarities were computed against. */
  searchQuery: string;
  /** Whether the production fold gate folded this golden's query. */
  folded: boolean;
}

/** A deterministic scoring policy over pooled candidate metadata (higher = better). */
export type FactScoringPolicy = (candidate: FactPooledCandidate) => number;

/**
 * Recency half-life for the decay term. 30 days: user-preference facts go stale
 * on the order of weeks (the repetition feedback involved months-old backfill
 * facts outranking fresh corrections), while identity-level facts survive decay
 * through their salience term instead.
 */
export const FACT_RECENCY_HALF_LIFE_DAYS = 30;

/** Exponential recency decay in (0, 1]: 1 at age 0, 0.5 at one half-life. */
export function recencyDecay(validFromMs: number, nowMs: number): number {
  const ageDays = Math.max(0, (nowMs - validFromMs) / 86_400_000);
  return Math.pow(0.5, ageDays / FACT_RECENCY_HALF_LIFE_DAYS);
}

/**
 * Tier weight in [0, 1]. 'corrected' is user-authored truth and outranks
 * model-observed facts; 'inferred' (consolidation, future) sits between —
 * distilled but not user-confirmed.
 */
export function tierWeight(tier: string): number {
  if (tier === 'corrected') {
    return 1;
  }
  if (tier === 'inferred') {
    return 0.6;
  }
  return 0.5;
}

export interface FactWeightVector {
  name: string;
  wSim: number;
  wSal: number;
  wRec: number;
  wTier: number;
}

/**
 * The PRE-REGISTERED candidate weight grid (conditional-fold discipline: the
 * grid is fixed before judging, so the winner is measured, not fished for).
 * All vectors sum to 1 so scores stay comparable across vectors.
 */
export const FACT_WEIGHT_GRID: readonly FactWeightVector[] = [
  { name: 'sim-heavy', wSim: 0.7, wSal: 0.15, wRec: 0.1, wTier: 0.05 },
  { name: 'balanced', wSim: 0.5, wSal: 0.2, wRec: 0.2, wTier: 0.1 },
  { name: 'rec-heavy', wSim: 0.5, wSal: 0.1, wRec: 0.3, wTier: 0.1 },
] as const;

/** Build the §3.4 composite policy for a weight vector, frozen at `nowMs`. */
export function compositePolicy(weights: FactWeightVector, nowMs: number): FactScoringPolicy {
  return candidate =>
    weights.wSim * candidate.similarity +
    weights.wSal * candidate.salience +
    weights.wRec * recencyDecay(candidate.createdAtMs, nowMs) +
    weights.wTier * tierWeight(candidate.tier);
}

/** The comparator's inputs — a subset so pre-pool rows (no verdict/ranks yet) qualify. */
type ProdOrderingInputs = Pick<
  FactPooledCandidate,
  'similarity' | 'createdAtMs' | 'salience' | 'corpusId'
>;

/**
 * The production ordering as a comparator (distance ASC ≡ similarity DESC,
 * then valid_from DESC, then salience DESC) — the baseline arm every composite
 * candidate is measured against. Ties broken by id for determinism.
 */
export function prodOrderingComparator(a: ProdOrderingInputs, b: ProdOrderingInputs): number {
  return (
    b.similarity - a.similarity ||
    b.createdAtMs - a.createdAtMs ||
    b.salience - a.salience ||
    a.corpusId.localeCompare(b.corpusId)
  );
}

/** Rank candidates by a policy: corpus id → 1-based rank (score DESC, ties by id). */
export function policyRanks(
  candidates: readonly FactPooledCandidate[],
  policy: FactScoringPolicy
): Map<string, number> {
  const scored = candidates.map(candidate => ({
    id: candidate.corpusId,
    score: policy(candidate),
  }));
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const ranks = new Map<string, number>();
  scored.forEach((entry, index) => ranks.set(entry.id, index + 1));
  return ranks;
}

/** Return a copy of the pool with a derived policy arm added to every candidate. */
export function withPolicyArm(
  pool: FactGoldenPool,
  armName: string,
  policy: FactScoringPolicy
): FactGoldenPool {
  const ranks = policyRanks(pool.candidates, policy);
  return {
    ...pool,
    arms: pool.arms.includes(armName) ? pool.arms : [...pool.arms, armName],
    candidates: pool.candidates.map(candidate => ({
      ...candidate,
      ranks: { ...candidate.ranks, [armName]: ranks.get(candidate.corpusId) ?? 0 },
    })),
  };
}

export interface RepetitionOverlap {
  /** Number of same-channel golden pairs measured. */
  pairs: number;
  /** Mean Jaccard overlap of the arm's top-K fact sets across those pairs. */
  meanJaccard: number;
}

/**
 * Mechanical repetition metric (no judgments needed): for every pair of goldens
 * sharing a channel, the Jaccard overlap of the arm's top-K fact ids. High
 * overlap = the same facts surface turn after turn — the "same fact over and
 * over" user feedback, measurable before/after any ranking change.
 */
export function repetitionOverlap(
  pools: readonly FactGoldenPool[],
  arm: string,
  k: number
): RepetitionOverlap {
  const topKByPool = pools.map(pool => ({
    channelId: pool.channelId,
    top: new Set(
      pool.candidates
        .filter(candidate => {
          const rank = candidate.ranks[arm];
          return rank !== undefined && rank >= 1 && rank <= k;
        })
        .map(candidate => candidate.corpusId)
    ),
  }));

  let pairs = 0;
  let jaccardSum = 0;
  for (let i = 0; i < topKByPool.length; i++) {
    for (let j = i + 1; j < topKByPool.length; j++) {
      if (topKByPool[i].channelId !== topKByPool[j].channelId) {
        continue;
      }
      const a = topKByPool[i].top;
      const b = topKByPool[j].top;
      if (a.size === 0 && b.size === 0) {
        continue;
      }
      const intersection = [...a].filter(id => b.has(id)).length;
      const union = new Set([...a, ...b]).size;
      pairs += 1;
      jaccardSum += union === 0 ? 0 : intersection / union;
    }
  }
  return { pairs, meanJaccard: pairs === 0 ? 0 : jaccardSum / pairs };
}

export interface TierRankLift {
  /** Corrected-tier candidates found across all pools. */
  correctedCandidates: number;
  /** Mean rank of corrected-tier candidates under the arm (lower = better). */
  meanCorrectedRank: number;
}

/**
 * Mechanical tier metric: mean rank of corrected-tier facts under an arm.
 * "Corrections outrank stale facts" shows up as this number dropping vs the
 * production baseline. Direct-lineage supersession is already a hard WHERE
 * exclusion — this measures the near-dup/paraphrase residue tier weighting
 * is meant to push down.
 */
export function tierRankLift(pools: readonly FactGoldenPool[], arm: string): TierRankLift {
  let count = 0;
  let rankSum = 0;
  for (const pool of pools) {
    for (const candidate of pool.candidates) {
      if (candidate.tier !== 'corrected') {
        continue;
      }
      const rank = candidate.ranks[arm];
      if (rank === undefined || rank < 1) {
        continue;
      }
      count += 1;
      rankSum += rank;
    }
  }
  return {
    correctedCandidates: count,
    meanCorrectedRank: count === 0 ? 0 : rankSum / count,
  };
}
