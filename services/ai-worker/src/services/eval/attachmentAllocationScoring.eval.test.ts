/**
 * Attachment-allocation scoring glue (TASK-393's A/B number).
 *
 * Reads the local pool (`allocation-pool.json`, produced by
 * `attachmentAllocationPooling.eval.test.ts`) and the judged relevance labels
 * (`allocation-qrels.json`, produced by hand-judging the sheet), and emits the
 * allocation A/B table via the committed `poolScoring` instrument — same
 * prefix-reconciliation integrity as the fold re-baseline.
 *
 * The decision this feeds: which allocation policy replaces "the embedder
 * truncates whatever the builder concatenated" — keep current, gate the
 * attachment part out (bare), lead-sentence it, or budget it.
 *
 * NOT a CI test: it reads LOCAL-ONLY gitignored artifacts. Skips itself
 * cleanly when either file is absent. Run: `pnpm eval:allocation-score`.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreArm, pairedFlips, combinedMissRate, type ScoredQuery } from './poolScoring.js';
import { reconcile, type GoldenPool, type PrefixQrels, type Qrels } from './qrelsReconciliation.js';
import { ALLOCATION_DENSE_ARMS, ALLOCATION_FTS_ARM } from './allocationArms.js';

const WORK_DIR = join(process.cwd(), 'reports/goldens-mining');
const POOL_PATH = join(WORK_DIR, 'allocation-pool.json');
const QRELS_PATH = join(WORK_DIR, 'allocation-qrels.json');
const REPORT_PATH = join(WORK_DIR, 'allocation-ab-result.md');

/** Arms in report order; production behavior is current-dense. */
const ARMS = [...ALLOCATION_DENSE_ARMS, ALLOCATION_FTS_ARM];
/** Ascending attachment-text dose, for the dose-response read. */
const DOSE_ORDER = ['bare-dense', 'lead-dense', 'budget-dense', 'current-dense'];
const K_VALUES = [5, 10] as const;

const ready = existsSync(POOL_PATH) && existsSync(QRELS_PATH);

describe.skipIf(!ready)('attachment-allocation scoring (local pool + qrels)', () => {
  it('emits the allocation A/B table', () => {
    const pools = (JSON.parse(readFileSync(POOL_PATH, 'utf8')) as { pools: GoldenPool[] }).pools;
    const prefixQrels = JSON.parse(readFileSync(QRELS_PATH, 'utf8')) as PrefixQrels;

    const { queries, qrels } = reconcile(pools, prefixQrels);
    const report = buildReport(pools, queries, qrels);
    writeFileSync(REPORT_PATH, report);
    console.log(`\n=== attachment-allocation A/B → ${REPORT_PATH} ===\n`);
    console.log(report);

    // At least one query must have scored, or reconciliation silently produced
    // nothing (the failure mode this glue exists to prevent).
    const scored = scoreArm(queries, qrels, 'current-dense', 10).scoredQueries;
    expect(scored).toBeGreaterThan(0);
  });
});

function buildReport(pools: GoldenPool[], queries: ScoredQuery[], qrels: Qrels): string {
  const lines: string[] = [
    '# Attachment-allocation A/B result',
    '',
    'How much attachment text should the memory-search query carry? Arms sweep the dose:',
    'bare (none) → lead (first sentence per description) → budget (≤1024 chars) → current',
    '(full text; the embedder truncates at 512 tokens). Every metric masks the relevant set',
    'to the non-circularity guard, as in the fold re-baseline.',
    '',
    `Goldens: ${pools.length}. Production behavior is **current-dense**.`,
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

  // The decisive question: does any alternative beat production's full-text head?
  lines.push('## Paired comparisons — current-dense vs each alternative', '');
  lines.push('| Treatment | K | both-hit | both-miss | fixes | breaks | net |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const arm of DOSE_ORDER.filter(a => a !== 'current-dense')) {
    for (const k of K_VALUES) {
      const f = pairedFlips(queries, qrels, 'current-dense', arm, k);
      lines.push(
        `| ${arm} | ${k} | ${f.bothHit} | ${f.bothMiss} | ${f.treatmentFixes} | ${f.treatmentBreaks} | ${signed(f.net)} |`
      );
    }
  }
  lines.push('');

  // Dose-response: is more attachment text monotonically better, worse, or peaked?
  lines.push('## Dose-response (dense) @ K=10', '');
  lines.push('| Arm (ascending attachment text) | recall@10 | miss-rate |');
  lines.push('| --- | --- | --- |');
  for (const arm of DOSE_ORDER) {
    const m = scoreArm(queries, qrels, arm, 10);
    lines.push(`| ${arm} | ${fmt(m.recallAtK)} | ${fmt(m.missRate)} |`);
  }
  lines.push('');

  lines.push(perKindSection(pools, queries, qrels));
  return `${lines.join('\n')}\n`;
}

/** Per-kind dense miss @10 — voice transcripts and image descriptions may want different policies. */
function perKindSection(pools: GoldenPool[], queries: ScoredQuery[], qrels: Qrels): string {
  const kindById = new Map(pools.map(pool => [pool.goldenId, pool.kind ?? 'unknown']));
  const kinds = [...new Set(pools.map(pool => pool.kind ?? 'unknown'))].sort();
  const lines = [
    '## Per-kind miss @ K=10 (dense arms)',
    '',
    `| Kind | ${DOSE_ORDER.join(' | ')} |`,
    `| --- | ${DOSE_ORDER.map(() => '---').join(' | ')} |`,
  ];
  for (const kind of kinds) {
    const subset = queries.filter(query => kindById.get(query.queryId) === kind);
    const cells = DOSE_ORDER.map(arm => {
      const miss = combinedMissRate(subset, qrels, [arm], 10);
      return `${miss.missedTurns}/${miss.scoredQueries}`;
    });
    lines.push(`| ${kind} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

function fmt(value: number): string {
  return value.toFixed(3);
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}
