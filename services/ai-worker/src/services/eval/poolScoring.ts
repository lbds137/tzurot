/**
 * Pool scoring: turn pooled per-arm rankings + judge relevance labels (qrels)
 * into the retrieval metrics that decide the bare-vs-folded retrieval A/B.
 *
 * Pure and committed (the pooling RUNNER and the qrels are local-only — the
 * corpus is sensitive — but the scoring MATH is the reusable, testable
 * instrument the memory epic's phase gates read).
 *
 * The fold-aware A/B pools SIX arms (bare-dense, fold{3,5,8}-dense, bare-fts,
 * fold3-fts) into one judgment sheet, judged once, scored against ONE qrels set.
 * Arms are named strings (a candidate carries a `rank` per arm it surfaced in),
 * so this generalizes to any arm set without a fixed dense/fts/rrf enum.
 *
 * The honesty hinge is the **non-circularity guard**: a candidate the fold window
 * already contains ('in-window' / 'echo') CANNOT earn credit for either arm —
 * folding must reach PAST what it carries. Every metric here masks the relevant
 * set to `verdict === 'eligible'` candidates, so both arms are scored only on
 * legitimately-reachable memories.
 */

import type { GuardVerdict } from './nonCircularityGuard.js';

/** A pooled candidate: its guard verdict + its 1-based rank in each arm that surfaced it. */
export interface ScoredCandidate {
  corpusId: string;
  /** Non-circularity guard verdict; only 'eligible' candidates can earn credit. */
  verdict: GuardVerdict;
  /** Arm name → 1-based rank (absent/null = the arm did not surface this candidate). */
  ranks: Record<string, number | null>;
}

export interface ScoredQuery {
  queryId: string;
  candidates: ScoredCandidate[];
}

/** query id → (corpus id → relevance grade). Absent = judged not-relevant (0). */
export type Qrels = Record<string, Record<string, number>>;

export interface ArmMetrics {
  /** Mean recall@K across queries with ≥1 guard-eligible relevant candidate. */
  recallAtK: number;
  /** Mean reciprocal rank of the first guard-eligible relevant candidate. */
  mrr: number;
  /** Fraction of scored queries where this arm surfaced NO eligible relevant in top-K. */
  missRate: number;
  /** Queries with ≥1 guard-eligible relevant candidate anywhere in the pool (the denominator). */
  scoredQueries: number;
}

/** RRF constant — the standard 60; damps the top-rank dominance of raw 1/rank. */
export const RRF_K = 60;

/**
 * Guard-eligible relevant ids for a query: judged relevant (grade > 0) AND the
 * candidate's guard verdict is 'eligible'. A relevant candidate the fold window
 * already carries (in-window / echo) is excluded — neither arm may earn it, so
 * the fold is credited only for reaching memories it did NOT already hold.
 */
export function eligibleRelevantIds(query: ScoredQuery, qrels: Qrels): Set<string> {
  const grades = qrels[query.queryId] ?? {};
  const verdictById = new Map(
    query.candidates.map(candidate => [candidate.corpusId, candidate.verdict])
  );
  const ids = new Set<string>();
  for (const [id, grade] of Object.entries(grades)) {
    if (grade > 0 && verdictById.get(id) === 'eligible') {
      ids.add(id);
    }
  }
  return ids;
}

/** Ranked corpus ids for one arm, best (rank 1) first, ties broken by id for determinism. */
export function rankedIds(candidates: ScoredCandidate[], arm: string): string[] {
  const ranked: { id: string; rank: number }[] = [];
  for (const candidate of candidates) {
    const rank = candidate.ranks[arm];
    if (rank !== null && rank !== undefined) {
      ranked.push({ id: candidate.corpusId, rank });
    }
  }
  ranked.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  return ranked.map(entry => entry.id);
}

/** True if the arm surfaced ≥1 of `relevant` within its top-K. */
function armHits(query: ScoredQuery, relevant: Set<string>, arm: string, k: number): boolean {
  const topK = rankedIds(query.candidates, arm).slice(0, k);
  return topK.some(id => relevant.has(id));
}

/**
 * Score one arm over all queries. recall@K / MRR / missRate use the arm's ranked
 * list capped at `k` against the guard-eligible relevant set; queries with no
 * eligible relevant candidate are excluded from every mean (they can't distinguish arms).
 */
export function scoreArm(queries: ScoredQuery[], qrels: Qrels, arm: string, k: number): ArmMetrics {
  let recallSum = 0;
  let mrrSum = 0;
  let misses = 0;
  let scored = 0;

  for (const query of queries) {
    const relevant = eligibleRelevantIds(query, qrels);
    if (relevant.size === 0) {
      continue;
    }
    scored += 1;

    const ranked = rankedIds(query.candidates, arm);
    const topK = ranked.slice(0, k);
    const hits = topK.filter(id => relevant.has(id)).length;
    recallSum += hits / relevant.size;
    if (hits === 0) {
      misses += 1;
    }

    const firstRelevantIndex = ranked.findIndex(id => relevant.has(id));
    mrrSum += firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1);
  }

  return {
    recallAtK: scored === 0 ? 0 : recallSum / scored,
    mrr: scored === 0 ? 0 : mrrSum / scored,
    missRate: scored === 0 ? 0 : misses / scored,
    scoredQueries: scored,
  };
}

/** Score a set of named arms at once — the A/B table. */
export function scoreArms(
  queries: ScoredQuery[],
  qrels: Qrels,
  arms: string[],
  k: number
): Record<string, ArmMetrics> {
  const out: Record<string, ArmMetrics> = {};
  for (const arm of arms) {
    out[arm] = scoreArm(queries, qrels, arm, k);
  }
  return out;
}

/**
 * Paired within-turn flips between a baseline and a treatment arm — the McNemar
 * discordant-pair signal that is the trustworthy comparison at small n (more
 * robust than a mean-recall delta). "Hit" = the arm surfaced ≥1 eligible relevant
 * in top-K. For (bare-dense, fold3-dense): `treatmentFixes` is folds that rescued
 * a bare miss; `treatmentBreaks` is folds that lost a bare hit; `net` is the signed win.
 */
export interface PairedFlips {
  /** Baseline hit AND treatment hit. */
  bothHit: number;
  /** Baseline missed AND treatment missed. */
  bothMiss: number;
  /** Treatment rescued a baseline miss (baseline miss → treatment hit). */
  treatmentFixes: number;
  /** Treatment lost a baseline hit (baseline hit → treatment miss). */
  treatmentBreaks: number;
  /** Signed win of treatment over baseline (treatmentFixes − treatmentBreaks). */
  net: number;
  scoredQueries: number;
}

export function pairedFlips(
  queries: ScoredQuery[],
  qrels: Qrels,
  baselineArm: string,
  treatmentArm: string,
  k: number
): PairedFlips {
  let bothHit = 0;
  let bothMiss = 0;
  let treatmentFixes = 0;
  let treatmentBreaks = 0;
  let scored = 0;

  for (const query of queries) {
    const relevant = eligibleRelevantIds(query, qrels);
    if (relevant.size === 0) {
      continue;
    }
    scored += 1;
    const baseHit = armHits(query, relevant, baselineArm, k);
    const treatHit = armHits(query, relevant, treatmentArm, k);
    if (baseHit && treatHit) {
      bothHit += 1;
    } else if (!baseHit && !treatHit) {
      bothMiss += 1;
    } else if (!baseHit && treatHit) {
      treatmentFixes += 1;
    } else {
      treatmentBreaks += 1;
    }
  }

  return {
    bothHit,
    bothMiss,
    treatmentFixes,
    treatmentBreaks,
    net: treatmentFixes - treatmentBreaks,
    scoredQueries: scored,
  };
}

/**
 * Combined miss rate over a SET of arms — the fraction of scored turns where EVERY
 * listed arm missed. Reproduces the original A/B's "both-arms-miss" headline
 * (e.g. `['bare-dense', 'bare-fts']` vs `['fold3-dense', 'fold3-fts']`) honestly
 * under the guard, so the fold's effect on the residual gap is directly comparable.
 */
export interface CombinedMiss {
  /** Turns where every listed arm missed. */
  missedTurns: number;
  scoredQueries: number;
  rate: number;
}

export function combinedMissRate(
  queries: ScoredQuery[],
  qrels: Qrels,
  arms: string[],
  k: number
): CombinedMiss {
  // `arms.every(...)` is vacuously true on an empty list, which would count EVERY
  // scored turn as a combined miss — a caller error, not a meaningful rate.
  if (arms.length === 0) {
    throw new Error('combinedMissRate requires at least one arm');
  }
  let missedTurns = 0;
  let scored = 0;

  for (const query of queries) {
    const relevant = eligibleRelevantIds(query, qrels);
    if (relevant.size === 0) {
      continue;
    }
    scored += 1;
    if (arms.every(arm => !armHits(query, relevant, arm, k))) {
      missedTurns += 1;
    }
  }

  return { missedTurns, scoredQueries: scored, rate: scored === 0 ? 0 : missedTurns / scored };
}

/**
 * RRF-fused rank map from a set of base arms: corpus id → 1-based fused rank.
 * A candidate is included iff at least one base arm surfaced it (union recall).
 * Kept as a derivation (not baked into every candidate) so the arm set stays open;
 * inject it via `withRrfArm` when an RRF perspective is wanted alongside the raw arms.
 */
export function rrfRanks(
  candidates: ScoredCandidate[],
  baseArms: string[],
  rrfK: number = RRF_K
): Map<string, number> {
  const scored = candidates
    .map(candidate => {
      let score = 0;
      let present = false;
      for (const arm of baseArms) {
        const rank = candidate.ranks[arm];
        if (rank !== null && rank !== undefined) {
          score += 1 / (rrfK + rank);
          present = true;
        }
      }
      return { id: candidate.corpusId, score: present ? score : null };
    })
    .filter((entry): entry is { id: string; score: number } => entry.score !== null);

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const map = new Map<string, number>();
  scored.forEach((entry, index) => map.set(entry.id, index + 1));
  return map;
}

/** Return a copy of the query with a derived RRF arm added to every candidate's rank map. */
export function withRrfArm(
  query: ScoredQuery,
  newArm: string,
  baseArms: string[],
  rrfK: number = RRF_K
): ScoredQuery {
  const fused = rrfRanks(query.candidates, baseArms, rrfK);
  return {
    queryId: query.queryId,
    candidates: query.candidates.map(candidate => ({
      ...candidate,
      ranks: { ...candidate.ranks, [newArm]: fused.get(candidate.corpusId) ?? null },
    })),
  };
}
