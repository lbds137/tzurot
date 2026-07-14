/**
 * Fact-scoring glue (memory 1b — the weight-sim NUMBER).
 *
 * Reads the local fact pool (`fact-pool.json`, produced by
 * `factPooling.eval.test.ts`) and the judged relevance labels
 * (`fact-qrels.json`, produced by hand-judging the sheet), and emits the
 * production-vs-composite A/B table via the committed `poolScoring` +
 * `factPoolScoring` instruments. The scoring MATH lives in those CI-tested
 * modules; this file is only eval-only glue that feeds them the local
 * artifacts and formats the report.
 *
 * Two tiers of arms:
 *  - PRE-REGISTERED (the headline): `prod` + the FACT_WEIGHT_GRID composites,
 *    whose top-K defined the judgment sheet's pooled coverage.
 *  - EXPLORATORY (labeled as such): extra weight vectors scored retroactively
 *    against the same persisted pool via `withPolicyArm`. TREC shallow-pooling
 *    caveat applies — candidates no display arm surfaced were never judged and
 *    score as not-relevant, so exploratory arms can only LOSE credit for
 *    reordering into unjudged territory. A strong exploratory number is a
 *    lower bound; a weak one is not conclusive.
 *
 * Also emits the mechanical instruments (no judgments needed): same-channel
 * repetition overlap (the "same fact over and over" user feedback) and
 * corrected-tier mean rank (the "corrections must outrank" concern).
 *
 * NOT a CI test: it reads LOCAL-ONLY gitignored artifacts. Skips itself
 * cleanly when either file is absent. Run: `pnpm eval:fact-score`.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreArm, pairedFlips, combinedMissRate, type ScoredQuery } from './poolScoring.js';
import { reconcile, type PrefixQrels, type Qrels } from './qrelsReconciliation.js';
import {
  FACT_WEIGHT_GRID,
  compositePolicy,
  repetitionOverlap,
  tierRankLift,
  withPolicyArm,
  type FactGoldenPool,
  type FactWeightVector,
} from './factPoolScoring.js';

const WORK_DIR = join(process.cwd(), 'reports/goldens-mining');
const POOL_PATH = join(WORK_DIR, 'fact-pool.json');
const QRELS_PATH = join(WORK_DIR, 'fact-qrels.json');
const REPORT_PATH = join(WORK_DIR, 'fact-score-result.md');

/** Pre-registered arms in report order; production retrieves with `prod`. */
const PREREGISTERED_ARMS = ['prod', ...FACT_WEIGHT_GRID.map(weights => weights.name)];
const K_VALUES = [5, 10] as const;

/**
 * Exploratory sweep — scored retroactively against the persisted pool (see
 * header caveat). Chosen to bracket the pre-registered grid: a pure-similarity
 * anchor, heavier single-signal pulls, and a tier-heavy probe for the
 * corrections concern.
 */
const EXPLORATORY_GRID: readonly FactWeightVector[] = [
  { name: 'x-pure-sim', wSim: 1, wSal: 0, wRec: 0, wTier: 0 },
  { name: 'x-sim-0.8', wSim: 0.8, wSal: 0.1, wRec: 0.05, wTier: 0.05 },
  { name: 'x-sal-heavy', wSim: 0.5, wSal: 0.3, wRec: 0.1, wTier: 0.1 },
  { name: 'x-rec-0.4', wSim: 0.4, wSal: 0.1, wRec: 0.4, wTier: 0.1 },
  { name: 'x-tier-0.2', wSim: 0.5, wSal: 0.15, wRec: 0.15, wTier: 0.2 },
] as const;

const ready = existsSync(POOL_PATH) && existsSync(QRELS_PATH);

describe.skipIf(!ready)('fact scoring (local pool + qrels)', () => {
  it('emits the prod-vs-composite A/B table', () => {
    const { nowMs, pools: rawPools } = JSON.parse(readFileSync(POOL_PATH, 'utf8')) as {
      nowMs: number;
      pools: FactGoldenPool[];
    };

    // Add the exploratory arms to every pool before reconciling, so their
    // ranks ride the same ScoredQuery projection the pre-registered arms use.
    // The persisted nowMs keeps recencyDecay deterministic across re-runs.
    const pools = rawPools.map(pool => {
      let extended = pool;
      for (const weights of EXPLORATORY_GRID) {
        extended = withPolicyArm(extended, weights.name, compositePolicy(weights, nowMs));
      }
      return extended;
    });

    const prefixQrels = JSON.parse(readFileSync(QRELS_PATH, 'utf8')) as PrefixQrels;
    const { queries, qrels } = reconcile(pools, prefixQrels);
    const report = buildReport(pools, queries, qrels);
    writeFileSync(REPORT_PATH, report);
    console.log(`\n=== fact scoring → ${REPORT_PATH} ===\n`);
    console.log(report);

    // At least one query must have scored, or the qrels reconciliation
    // silently produced nothing (the failure mode this glue exists to prevent).
    const scored = scoreArm(queries, qrels, 'prod', 10).scoredQueries;
    expect(scored).toBeGreaterThan(0);
  });
});

function formatArmRow(queries: ScoredQuery[], qrels: Qrels, arm: string): string {
  const cells = K_VALUES.map(k => {
    const metrics = scoreArm(queries, qrels, arm, k);
    return `${metrics.recallAtK.toFixed(3)} | ${metrics.missRate.toFixed(3)}`;
  });
  const mrr = scoreArm(queries, qrels, arm, 10).mrr.toFixed(3);
  return `| ${arm} | ${cells.join(' | ')} | ${mrr} |`;
}

function formatFlipsRow(queries: ScoredQuery[], qrels: Qrels, arm: string): string {
  const flips = pairedFlips(queries, qrels, 'prod', arm, 10);
  return `| prod → ${arm} | ${flips.treatmentFixes} | ${flips.treatmentBreaks} | ${flips.net >= 0 ? '+' : ''}${flips.net} | ${flips.bothMiss} |`;
}

function buildReport(pools: FactGoldenPool[], queries: ScoredQuery[], qrels: Qrels): string {
  const allArms = [...PREREGISTERED_ARMS, ...EXPLORATORY_GRID.map(weights => weights.name)];
  const lines: string[] = [
    '# Fact-retrieval weight sim (memory 1b)',
    '',
    `Pools: ${pools.length} goldens · scored (≥1 eligible relevant): ${scoreArm(queries, qrels, 'prod', 10).scoredQueries}`,
    '',
    '## Pre-registered arms (judged pooled coverage)',
    '',
    '| arm | recall@5 | miss@5 | recall@10 | miss@10 | MRR |',
    '|---|---|---|---|---|---|',
    ...PREREGISTERED_ARMS.map(arm => formatArmRow(queries, qrels, arm)),
    '',
    '## Paired flips vs prod (@10)',
    '',
    '| comparison | fixes | breaks | net | both-miss |',
    '|---|---|---|---|---|',
    ...allArms.filter(arm => arm !== 'prod').map(arm => formatFlipsRow(queries, qrels, arm)),
    '',
    '## Exploratory arms (retroactive — unjudged-as-irrelevant lower bounds)',
    '',
    '| arm | recall@5 | miss@5 | recall@10 | miss@10 | MRR |',
    '|---|---|---|---|---|---|',
    ...EXPLORATORY_GRID.map(weights => formatArmRow(queries, qrels, weights.name)),
    '',
    `Combined miss@10 across pre-registered arms: ${combinedMissRate(queries, qrels, PREREGISTERED_ARMS, 10).rate.toFixed(3)}`,
    '',
    '## Mechanical instruments (no judgments)',
    '',
    '| arm | same-channel top-10 Jaccard (pairs) | corrected-tier mean rank (n) |',
    '|---|---|---|',
    ...allArms.map(arm => {
      const repetition = repetitionOverlap(pools, arm, 10);
      const tier = tierRankLift(pools, arm);
      return `| ${arm} | ${repetition.meanJaccard.toFixed(3)} (${repetition.pairs}) | ${tier.meanCorrectedRank.toFixed(1)} (${tier.correctedCandidates}) |`;
    }),
    '',
  ];
  return lines.join('\n');
}
