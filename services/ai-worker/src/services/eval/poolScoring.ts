/**
 * Pool scoring: turn pooled per-arm rankings + owner/judge relevance labels
 * (qrels) into the retrieval metrics that decide the dense-vs-hybrid A/B.
 *
 * Pure and committed (the pooling RUNNER and the qrels are local-only — the
 * corpus is sensitive — but the scoring MATH is the reusable, testable
 * instrument the memory epic's phase gates read).
 *
 * Three arms are scored against ONE qrels set:
 *  - dense  — production pgvector ranking
 *  - fts    — Postgres FTS-OR ranking (the lexical perspective)
 *  - rrf    — Reciprocal Rank Fusion of the two (what the parked hybrid branch
 *             implements in SQL; computed here from the collected ranks so the
 *             A/B needs no branch checkout).
 */

/** A pooled candidate with its rank in each arm (null = arm didn't surface it). */
export interface ScoredCandidate {
  corpusId: string;
  denseRank: number | null;
  ftsRank: number | null;
}

export interface ScoredQuery {
  queryId: string;
  candidates: ScoredCandidate[];
}

/** query id → (corpus id → relevance grade). Absent = judged not-relevant (0). */
export type Qrels = Record<string, Record<string, number>>;

export type ArmName = 'dense' | 'fts' | 'rrf';

export interface ArmMetrics {
  /** Mean recall@K across queries that have ≥1 relevant candidate. */
  recallAtK: number;
  /** Mean reciprocal rank of the first relevant candidate. */
  mrr: number;
  /** Queries with ≥1 relevant candidate anywhere in the pool (the denominator). */
  scoredQueries: number;
}

/** RRF constant — the standard 60; damps the top-rank dominance of raw 1/rank. */
export const RRF_K = 60;

/** A rank list per arm for one query, ties broken by corpus id for determinism. */
function rankedIds(candidates: ScoredCandidate[], arm: ArmName): string[] {
  const keyed = candidates
    .map(candidate => ({ id: candidate.corpusId, score: armScore(candidate, arm) }))
    .filter(entry => entry.score !== null) as { id: string; score: number }[];
  // Higher score = better. dense/fts scores are negative rank (rank 1 → -1),
  // rrf is the summed reciprocal (higher = better) — both sort descending.
  keyed.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return keyed.map(entry => entry.id);
}

/** Per-arm comparable score (higher = better), or null if the arm didn't rank it. */
function armScore(candidate: ScoredCandidate, arm: ArmName): number | null {
  if (arm === 'dense') {
    return candidate.denseRank === null ? null : -candidate.denseRank;
  }
  if (arm === 'fts') {
    return candidate.ftsRank === null ? null : -candidate.ftsRank;
  }
  // RRF: sum of 1/(K+rank) over the arms that surfaced this candidate.
  let score = 0;
  let present = false;
  if (candidate.denseRank !== null) {
    score += 1 / (RRF_K + candidate.denseRank);
    present = true;
  }
  if (candidate.ftsRank !== null) {
    score += 1 / (RRF_K + candidate.ftsRank);
    present = true;
  }
  return present ? score : null;
}

/**
 * Score one arm over all queries. recall@K uses the arm's ranked list capped at
 * `k`; queries with no relevant candidate in the pool are excluded from both
 * means (they can't distinguish arms).
 */
export function scoreArm(
  queries: ScoredQuery[],
  qrels: Qrels,
  arm: ArmName,
  k: number
): ArmMetrics {
  let recallSum = 0;
  let mrrSum = 0;
  let scored = 0;

  for (const query of queries) {
    const relevant = new Set(
      Object.entries(qrels[query.queryId] ?? {})
        .filter(([, grade]) => grade > 0)
        .map(([id]) => id)
    );
    if (relevant.size === 0) {
      continue;
    }
    scored += 1;

    const ranked = rankedIds(query.candidates, arm);
    const topK = ranked.slice(0, k);
    const hits = topK.filter(id => relevant.has(id)).length;
    recallSum += hits / relevant.size;

    const firstRelevantIndex = ranked.findIndex(id => relevant.has(id));
    mrrSum += firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1);
  }

  return {
    recallAtK: scored === 0 ? 0 : recallSum / scored,
    mrr: scored === 0 ? 0 : mrrSum / scored,
    scoredQueries: scored,
  };
}

/** Score all three arms at once — the A/B table. */
export function scoreAllArms(
  queries: ScoredQuery[],
  qrels: Qrels,
  k: number
): Record<ArmName, ArmMetrics> {
  return {
    dense: scoreArm(queries, qrels, 'dense', k),
    fts: scoreArm(queries, qrels, 'fts', k),
    rrf: scoreArm(queries, qrels, 'rrf', k),
  };
}
