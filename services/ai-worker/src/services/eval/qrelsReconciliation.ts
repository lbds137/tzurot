/**
 * Qrels reconciliation: translate a prefix-keyed judgment file into the full-id
 * `ScoredQuery[]` + qrels the `poolScoring` instrument consumes.
 *
 * The judgment sheet shows 8-char id prefixes, so the hand-authored `qrels` is
 * keyed by those prefixes. This resolves every prefix back to its FULL corpus/golden
 * id and HARD-ERRORS on any ambiguous (>1 match) or unresolvable (0 match) prefix —
 * the integrity guarantee that a mis-keyed judgment can never silently score against
 * the wrong candidate (it caught a real cross-golden mis-attribution in practice).
 *
 * Pure JSON→object logic with no external dependency, so it lives here (CI-tested)
 * rather than inside the eval-only glue that merely calls it — the shared pool types
 * (`PooledCandidate` / `GoldenPool`) are the single source both the pooling producer
 * and the scoring consumer import, so the two can't drift.
 */

import type { GuardVerdict } from './nonCircularityGuard.js';
import type { ScoredQuery, ScoredCandidate } from './poolScoring.js';

/** A persisted pooled candidate: its rank in each arm + the non-circularity guard verdict. */
export interface PooledCandidate {
  corpusId: string;
  createdAtMs: number;
  contentPreview: string;
  ranks: Record<string, number>;
  verdict: GuardVerdict;
}

/** One golden's pooled candidates across all arms, plus the fold-window metadata. */
export interface GoldenPool {
  goldenId: string;
  message: string;
  style: string;
  oldestHistoryMs: number;
  arms: string[];
  candidates: PooledCandidate[];
}

/**
 * One golden's judgments: candidate-prefix → numeric grade, plus optional `_`-prefixed
 * free-text annotations (e.g. `_theme`) — hence `number | string`. A non-`_` key with a
 * non-numeric value is a typo, caught during reconcile.
 */
export type GoldenQrels = Record<string, number | string>;

/**
 * Prefix-keyed qrels: golden-prefix → that golden's judgments, plus optional top-level
 * `_`-prefixed free-text annotations (e.g. `_rubric`) — hence `GoldenQrels | string`.
 * Skipping `_` keys keeps the local artifact self-documenting; a non-`_` top-level key
 * whose value isn't an object is a malformed entry, caught during reconcile.
 */
export type PrefixQrels = Record<string, GoldenQrels | string>;

/** Full-id qrels: golden id → (corpus id → grade). */
export type Qrels = Record<string, Record<string, number>>;

export interface ReconcileResult {
  queries: ScoredQuery[];
  qrels: Qrels;
}

/**
 * Map the pools into `ScoredQuery[]` (full ids) and translate the prefix-keyed qrels
 * into full-id qrels. Collects EVERY prefix that matches zero or multiple ids and
 * throws once with the full list — so a hand-authored qrels with several typos is
 * fixed in one pass, not one run-fail cycle per bad prefix.
 */
export function reconcile(pools: GoldenPool[], prefixQrels: PrefixQrels): ReconcileResult {
  const queries: ScoredQuery[] = pools.map(pool => ({
    queryId: pool.goldenId,
    candidates: pool.candidates.map((candidate): ScoredCandidate => ({
      corpusId: candidate.corpusId,
      verdict: candidate.verdict,
      ranks: candidate.ranks,
    })),
  }));

  const qrels: Qrels = {};
  const errors: string[] = [];
  for (const [goldenPrefix, candGrades] of Object.entries(prefixQrels)) {
    if (goldenPrefix.startsWith('_')) {
      continue;
    }
    if (typeof candGrades !== 'object' || candGrades === null) {
      errors.push(
        `golden prefix "${goldenPrefix}" has a non-object value (expected a judgments map)`
      );
      continue;
    }
    const pool = resolveOne(
      pools,
      p => p.goldenId.startsWith(goldenPrefix),
      `golden prefix "${goldenPrefix}"`,
      errors
    );
    if (pool === undefined) {
      continue;
    }
    qrels[pool.goldenId] = resolveGrades(pool, candGrades, errors);
  }
  if (errors.length > 0) {
    throw new Error(
      `qrels reconciliation failed for ${errors.length} prefix(es):\n  ${errors.join('\n  ')}`
    );
  }
  return { queries, qrels };
}

/**
 * Resolve one golden's `candidate-prefix → grade` map into full-id grades, pushing a
 * diagnostic (rather than throwing) for each: `_`-annotation keys are skipped, a
 * non-numeric grade on a data key is a typo, an unresolvable/ambiguous prefix is caught
 * by `resolveOne`, and two prefixes resolving to the same candidate is a silent-overwrite
 * hole — the exact "mis-keyed judgment scores wrong" class this module exists to close.
 */
function resolveGrades(
  pool: GoldenPool,
  candGrades: GoldenQrels,
  errors: string[]
): Record<string, number> {
  const where = `in golden ${pool.goldenId.slice(0, 8)}`;
  const grades: Record<string, number> = {};
  for (const [candPrefix, grade] of Object.entries(candGrades)) {
    if (candPrefix.startsWith('_')) {
      continue;
    }
    if (typeof grade !== 'number') {
      errors.push(
        `candidate prefix "${candPrefix}" ${where} has a non-numeric grade (${JSON.stringify(grade)})`
      );
      continue;
    }
    const candidate = resolveOne(
      pool.candidates,
      c => c.corpusId.startsWith(candPrefix),
      `candidate prefix "${candPrefix}" ${where}`,
      errors
    );
    if (candidate === undefined) {
      continue;
    }
    if (candidate.corpusId in grades) {
      errors.push(
        `candidate prefix "${candPrefix}" ${where} resolves to ${candidate.corpusId.slice(0, 8)}, already graded by another prefix`
      );
      continue;
    }
    grades[candidate.corpusId] = grade;
  }
  return grades;
}

/** Record exactly-one match, or push a diagnostic to `errors` (no throw — the caller
 * collects all failures and throws once). Returns undefined on a zero/ambiguous match. */
function resolveOne<T>(
  items: T[],
  match: (item: T) => boolean,
  label: string,
  errors: string[]
): T | undefined {
  const hits = items.filter(match);
  if (hits.length !== 1) {
    errors.push(`${label} matched ${hits.length} ids (expected exactly 1)`);
    return undefined;
  }
  return hits[0];
}
