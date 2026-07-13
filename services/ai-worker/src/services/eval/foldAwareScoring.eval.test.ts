/**
 * Fold-aware scoring glue (the honest re-baseline NUMBER).
 *
 * Reads the local pool (`fold-pool.json`, produced by `foldAwarePooling.eval.test.ts`)
 * and the judged relevance labels (`qrels.json`, produced by hand-judging the
 * sheet), and emits the bare-vs-folded A/B table via the committed `poolScoring`
 * instrument. The scoring MATH lives in `poolScoring.ts` (+ its CI-run test); this
 * file is only the eval-only glue that feeds it the local artifacts and formats
 * the report.
 *
 * The integrity fix over the old hand-assembled `AB-RESULT.md`: the judgment sheet
 * shows 8-char id prefixes, so `qrels.json` is keyed by those prefixes. This
 * reconciles every prefix back to its FULL corpus/golden id and HARD-ERRORS on any
 * ambiguous or unresolvable prefix — a mis-keyed qrels can no longer silently score
 * against the wrong candidate.
 *
 * NOT a CI test: it reads LOCAL-ONLY gitignored artifacts. Skips itself cleanly
 * when either file is absent. Run: `pnpm eval:fold-score`.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreArm, pairedFlips, combinedMissRate, type ScoredQuery } from './poolScoring.js';
import { reconcile, type GoldenPool, type PrefixQrels, type Qrels } from './qrelsReconciliation.js';

const WORK_DIR = join(process.cwd(), 'reports/goldens-mining');
const POOL_PATH = join(WORK_DIR, 'fold-pool.json');
const QRELS_PATH = join(WORK_DIR, 'fold-qrels.json');
const REPORT_PATH = join(WORK_DIR, 'fold-ab-result.md');

/** Arms in report order; production retrieves with fold3-dense. */
const ARMS = ['bare-dense', 'fold3-dense', 'fold5-dense', 'fold8-dense', 'bare-fts', 'fold3-fts'];
const DENSE_SWEEP = ['fold3-dense', 'fold5-dense', 'fold8-dense'];
const K_VALUES = [5, 10] as const;

const ready = existsSync(POOL_PATH) && existsSync(QRELS_PATH);

describe.skipIf(!ready)('fold-aware scoring (local pool + qrels)', () => {
  it('emits the bare-vs-folded A/B table', () => {
    const pools = (JSON.parse(readFileSync(POOL_PATH, 'utf8')) as { pools: GoldenPool[] }).pools;
    const prefixQrels = JSON.parse(readFileSync(QRELS_PATH, 'utf8')) as PrefixQrels;

    const { queries, qrels } = reconcile(pools, prefixQrels);
    const report = buildReport(pools, queries, qrels);
    writeFileSync(REPORT_PATH, report);
    console.log(`\n=== fold-aware A/B → ${REPORT_PATH} ===\n`);
    console.log(report);

    // The report must have scored at least one query, or the qrels reconciliation
    // silently produced nothing (the failure mode this glue exists to prevent).
    const scored = scoreArm(queries, qrels, 'fold3-dense', 10).scoredQueries;
    expect(scored).toBeGreaterThan(0);
  });
});

function buildReport(pools: GoldenPool[], queries: ScoredQuery[], qrels: Qrels): string {
  const lines: string[] = [
    '# Fold-aware A/B result (honest re-baseline)',
    '',
    'Bare-vs-folded retrieval on real mined Lila turns. Every metric masks the relevant',
    'set to the non-circularity guard — a memory the fold window already contained is',
    'excluded, so the fold earns credit only for reaching PAST what it carries.',
    '',
    `Goldens: ${pools.length}. Production retrieves with **fold3-dense**.`,
    '',
  ];

  for (const k of K_VALUES) {
    lines.push(`## Per-arm metrics @ K=${k}`, '');
    lines.push('| Arm | recall@K | MRR | miss-rate | scored |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const arm of ARMS) {
      const m = scoreArm(queries, qrels, arm, k);
      lines.push(
        `| ${arm} | ${fmt(m.recallAtK)} | ${fmt(m.mrr)} | ${fmt(m.missRate)} | ${m.scoredQueries} |`
      );
    }
    lines.push('');
  }

  // The decisive comparison: does the production fold beat the bare message?
  lines.push('## Decisive paired comparison — bare-dense → fold3-dense', '');
  lines.push('| K | both-hit | both-miss | fold-fixes | fold-breaks | net |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const k of K_VALUES) {
    const f = pairedFlips(queries, qrels, 'bare-dense', 'fold3-dense', k);
    lines.push(
      `| ${k} | ${f.bothHit} | ${f.bothMiss} | ${f.treatmentFixes} | ${f.treatmentBreaks} | ${signed(f.net)} |`
    );
  }
  lines.push('');

  // The original A/B headline reproduced honestly: both dense AND fts miss.
  lines.push('## Both-arms-miss (the original 30% metric, guard-honest)', '');
  lines.push('| K | bare (dense+fts) | fold3 (dense+fts) |');
  lines.push('| --- | --- | --- |');
  for (const k of K_VALUES) {
    const bare = combinedMissRate(queries, qrels, ['bare-dense', 'bare-fts'], k);
    const fold = combinedMissRate(queries, qrels, ['fold3-dense', 'fold3-fts'], k);
    lines.push(
      `| ${k} | ${bare.missedTurns}/${bare.scoredQueries} (${fmt(bare.rate)}) | ${fold.missedTurns}/${fold.scoredQueries} (${fmt(fold.rate)}) |`
    );
  }
  lines.push('');

  // Turn sweep: does more folded context beyond production's 3 turns help?
  lines.push('## Fold-depth sweep (dense) @ K=10', '');
  lines.push('| Arm | recall@10 | miss-rate |');
  lines.push('| --- | --- | --- |');
  for (const arm of DENSE_SWEEP) {
    const m = scoreArm(queries, qrels, arm, 10);
    lines.push(`| ${arm} | ${fmt(m.recallAtK)} | ${fmt(m.missRate)} |`);
  }
  lines.push('');

  lines.push(perStyleSection(pools, queries, qrels));
  return `${lines.join('\n')}\n`;
}

/** Per-style both-arms-miss (bare vs fold3) — where does folding help most? */
function perStyleSection(pools: GoldenPool[], queries: ScoredQuery[], qrels: Qrels): string {
  const styleById = new Map(pools.map(p => [p.goldenId, p.style]));
  const styles = [...new Set(pools.map(p => p.style))].sort();
  const lines = [
    '## Per-style both-arms-miss @ K=10 (bare dense+fts vs fold3 dense+fts)',
    '',
    '| Style | bare miss | fold3 miss |',
    '| --- | --- | --- |',
  ];
  for (const style of styles) {
    const subset = queries.filter(q => styleById.get(q.queryId) === style);
    const bare = combinedMissRate(subset, qrels, ['bare-dense', 'bare-fts'], 10);
    const fold = combinedMissRate(subset, qrels, ['fold3-dense', 'fold3-fts'], 10);
    lines.push(
      `| ${style} | ${bare.missedTurns}/${bare.scoredQueries} (${fmt(bare.rate)}) | ${fold.missedTurns}/${fold.scoredQueries} (${fmt(fold.rate)}) |`
    );
  }
  return lines.join('\n');
}

function fmt(value: number): string {
  return value.toFixed(3);
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}
