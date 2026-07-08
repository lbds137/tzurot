/**
 * UX Literal-Adoption Ratchet (audit-class tool)
 *
 * Counts raw user-facing message literals in bot-client's command surface —
 * the strings the `ux/catalog` message layer exists to replace — and fails
 * when the count grows past the baseline (`baseline.total + graceMargin`).
 * The cheap regression brake while catalog adoption is underway (design:
 * platform-portable-ux-design §4.5, two-stage enforcement — this grep-class
 * ratchet retires when Phase 3's AST ESLint rule lands).
 *
 *   1. `pnpm ops ux:literals`                  → compares against the baseline (CI gate)
 *   2. `pnpm ops ux:literals:update-baseline`  → sanctioned refresh (adoption drops)
 *
 * Two patterns, deliberately NOT three: the audit's third candidate
 * ("Failed to") is polluted by logger-call lines (internal, not user-facing),
 * and its genuine user-facing instances co-occur with the ❌ prefix that
 * pattern 1 already counts. Measurement quality beats coverage here.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import {
  buildBaselineMeta,
  checkMetaDrift,
  hashConfigSlice,
  type BaselineMeta,
} from './baseline-meta.js';
import { emitSummary } from './summary.js';

/**
 * Bump whenever the measurement-affecting logic changes (patterns, scan
 * root, file filter) — invalidates baselines and forces an explicit
 * `ux:literals:update-baseline` refresh.
 */
export const UX_LITERALS_IMPL_VERSION = 1;

export const PATTERN_IDS = ['emoji-prefixed', 'try-again'] as const;
export type PatternId = (typeof PATTERN_IDS)[number];

/**
 * The raw-literal classes the catalog replaces. Sources are part of the
 * config fingerprint — editing one is a measurement change.
 */
const PATTERNS: Record<PatternId, RegExp> = {
  // A hand-written ❌ prefix — the marker of a raw user-facing error literal
  // (the renderer owns glyphs; catalog-rendered strings never hand-write it).
  'emoji-prefixed': /❌/g,
  // A hand-written retry invitation — the outcome-honesty rule requires these
  // to come from the catalog (which knows when a retry is a lie).
  'try-again': /please try again/gi,
};

/** Where raw literals live: the command surface (non-test source files). */
export const SCAN_ROOT = 'services/bot-client/src/commands';

export const DEFAULT_UX_LITERALS_BASELINE_PATH = '.github/baselines/ux-literals-baseline.json';

const DEFAULT_GRACE_MARGIN = 10;

/** The measurement-affecting config slice — the baseline drift contract. */
export function getUxLiteralsConfigFingerprint(): Record<string, unknown> {
  return {
    implVersion: UX_LITERALS_IMPL_VERSION,
    scanRoot: SCAN_ROOT,
    patterns: PATTERN_IDS.map(id => ({
      id,
      source: PATTERNS[id].source,
      flags: PATTERNS[id].flags,
    })),
  };
}

export interface UxLiteralsMeasurement {
  total: number;
  byPattern: Record<PatternId, number>;
  /**
   * Files scanned. Zero is the hollow-measurement signal: a moved/renamed
   * commands directory must fail loudly, never pass at 0 literals.
   */
  fileCount: number;
}

function walkTsFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      walkTsFiles(full, out);
    } else if (full.endsWith('.ts') && !full.endsWith('.test.ts') && !full.endsWith('.d.ts')) {
      out.push(full);
    }
  }
}

/** Measure the raw-literal counts under `rootDir`. */
export function measureUxLiterals(rootDir: string): UxLiteralsMeasurement {
  const files: string[] = [];
  walkTsFiles(join(rootDir, SCAN_ROOT), files);

  const byPattern = Object.fromEntries(PATTERN_IDS.map(id => [id, 0])) as Record<PatternId, number>;
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    for (const id of PATTERN_IDS) {
      byPattern[id] += content.match(PATTERNS[id])?.length ?? 0;
    }
  }

  return {
    total: PATTERN_IDS.reduce((sum, id) => sum + byPattern[id], 0),
    byPattern,
    fileCount: files.length,
  };
}

export interface UxLiteralsBaseline {
  total: number;
  byPattern?: Record<string, number>;
  graceMargin: number;
  meta?: BaselineMeta;
  notes?: string;
}

/** Parse + shape-check the baseline file. Throws with a descriptive message. */
export function parseUxLiteralsBaseline(raw: string, path: string): UxLiteralsBaseline {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`UX literals baseline is not an object: ${path}`);
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.total !== 'number' || !Number.isFinite(obj.total)) {
    throw new Error(`UX literals baseline needs a numeric "total": ${path}`);
  }
  if (typeof obj.graceMargin !== 'number' || !Number.isFinite(obj.graceMargin)) {
    throw new Error(`UX literals baseline needs a numeric "graceMargin": ${path}`);
  }
  return obj as unknown as UxLiteralsBaseline;
}

export interface UxLiteralsOutcome {
  status: 'ok' | 'fail';
  failures: string[];
  measurement: UxLiteralsMeasurement;
  limit: number;
}

/**
 * Pure ratchet evaluation: the union count must stay at or below
 * `baseline.total + graceMargin`; zero files scanned is a loud failure.
 */
export function evaluateUxLiterals(
  measurement: UxLiteralsMeasurement,
  baseline: UxLiteralsBaseline
): UxLiteralsOutcome {
  const limit = baseline.total + baseline.graceMargin;
  const failures: string[] = [];

  if (measurement.fileCount === 0) {
    failures.push(
      `scan root matched zero files (${SCAN_ROOT}) — a hollow measurement is not a pass; ` +
        'check that the commands directory still exists at its expected path'
    );
  } else if (measurement.total > limit) {
    failures.push(
      `${measurement.total} raw user-facing literals exceeds the limit ${limit} ` +
        `(baseline ${baseline.total} + grace ${baseline.graceMargin}); ` +
        'new messages must come from ux/catalog — or, if the growth is deliberate, ' +
        'make it explicit via `pnpm ops ux:literals:update-baseline`'
    );
  }

  return { status: failures.length === 0 ? 'ok' : 'fail', failures, measurement, limit };
}

export interface UxLiteralsCheckOptions {
  baseline?: string;
  summary?: boolean;
  /** Return instead of setting a failure exit code (canary/test use). */
  noFail?: boolean;
  /** Repo root override for tests/canaries. */
  rootDir?: string;
}

/** CLI shell for `ux:literals`. */
export function runUxLiteralsCheck(options: UxLiteralsCheckOptions = {}): 'ok' | 'fail' {
  const rootDir = options.rootDir ?? process.cwd();
  const baselinePath = resolve(rootDir, options.baseline ?? DEFAULT_UX_LITERALS_BASELINE_PATH);

  if (!existsSync(baselinePath)) {
    console.error(chalk.red(`✗ UX literals baseline not found: ${baselinePath}`));
    console.error(chalk.dim('Run `pnpm ops ux:literals:update-baseline` to capture one.'));
    return failOutcome(options, 0, 0);
  }

  const baseline = parseUxLiteralsBaseline(readFileSync(baselinePath, 'utf-8'), baselinePath);

  const currentHash = hashConfigSlice(getUxLiteralsConfigFingerprint());
  const drift = checkMetaDrift(baseline.meta, currentHash);
  if (!drift.aligned) {
    console.error(chalk.red(`✗ UX literals baseline meta drift: ${drift.detail}`));
    console.error(
      chalk.dim(
        'The baseline was captured under different ratchet config. ' +
          'Run `pnpm ops ux:literals:update-baseline` to refresh.'
      )
    );
    return failOutcome(options, 1, baseline.total);
  }

  const measurement = measureUxLiterals(rootDir);
  const outcome = evaluateUxLiterals(measurement, baseline);

  for (const id of PATTERN_IDS) {
    console.log(chalk.dim(`  ${id}: ${measurement.byPattern[id]}`));
  }
  const totalLine = `  total: ${measurement.total} (limit ${outcome.limit}, baseline ${baseline.total})`;
  console.log(outcome.status === 'ok' ? chalk.green(totalLine) : chalk.red(totalLine));

  if (outcome.status === 'fail') {
    console.error(chalk.red.bold('✗ UX literal-adoption ratchet failed:'));
    for (const failure of outcome.failures) {
      console.error(chalk.red(`   ${failure}`));
    }
    return failOutcome(options, measurement.total, baseline.total);
  }

  console.log(chalk.green('✓ Raw user-facing literal count within the adoption ratchet'));
  if (options.summary === true) {
    emitUxLiteralsSummary('ok', measurement.total, baseline.total, currentHash);
  }
  return 'ok';
}

function failOutcome(options: UxLiteralsCheckOptions, findings: number, baseline: number): 'fail' {
  if (options.summary === true) {
    emitUxLiteralsSummary(
      'fail',
      findings,
      baseline,
      hashConfigSlice(getUxLiteralsConfigFingerprint())
    );
  }
  if (options.noFail !== true) {
    process.exitCode = 1;
  }
  return 'fail';
}

function emitUxLiteralsSummary(
  status: 'ok' | 'fail',
  findings: number,
  baseline: number,
  configHash: string
): void {
  emitSummary({
    tool: 'ux:literals',
    status,
    findings,
    baseline,
    meta: {
      toolVersion: `ux-literals-check/${UX_LITERALS_IMPL_VERSION}`,
      configHash,
      nodeVersion: process.version,
      generatedAt: new Date().toISOString(),
    },
  });
}

export interface UxLiteralsUpdateOptions {
  baseline?: string;
  dryRun?: boolean;
  rootDir?: string;
}

/** CLI shell for `ux:literals:update-baseline`. */
export function runUxLiteralsUpdateBaseline(options: UxLiteralsUpdateOptions = {}): void {
  const rootDir = options.rootDir ?? process.cwd();
  const baselinePath = resolve(rootDir, options.baseline ?? DEFAULT_UX_LITERALS_BASELINE_PATH);

  const previous: Partial<UxLiteralsBaseline> = existsSync(baselinePath)
    ? parseUxLiteralsBaseline(readFileSync(baselinePath, 'utf-8'), baselinePath)
    : {};

  const measurement = measureUxLiterals(rootDir);
  if (measurement.fileCount === 0) {
    throw new Error(
      `Cannot update baseline: scan root matched zero files (${SCAN_ROOT}). ` +
        'Fix the scan path before refreshing.'
    );
  }

  const configHash = hashConfigSlice(getUxLiteralsConfigFingerprint());
  const meta = buildBaselineMeta(`ux-literals-check/${UX_LITERALS_IMPL_VERSION}`, configHash);
  const updated: UxLiteralsBaseline = {
    ...previous,
    total: measurement.total,
    byPattern: measurement.byPattern,
    graceMargin:
      typeof previous.graceMargin === 'number' ? previous.graceMargin : DEFAULT_GRACE_MARGIN,
    meta,
  };

  console.log(chalk.bold('UX literals baseline update'));
  const prevTotal = previous.total;
  const deltaStr =
    prevTotal === undefined
      ? chalk.dim('(new)')
      : updated.total <= prevTotal
        ? chalk.green(`(${updated.total - prevTotal})`)
        : chalk.yellow(`(+${updated.total - prevTotal})`);
  console.log(`  total: ${updated.total} ${deltaStr}  grace ${updated.graceMargin}`);
  for (const id of PATTERN_IDS) {
    console.log(chalk.dim(`  ${id}: ${measurement.byPattern[id]}`));
  }

  if (options.dryRun === true) {
    console.log(chalk.dim('--dry-run: file not written.'));
    return;
  }

  writeFileSync(baselinePath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  console.log(chalk.green(`✓ Baseline written to ${baselinePath}`));
}
