/**
 * Mutation-Score Ratchet (audit-class tool)
 *
 * Reads Stryker's JSON report(s) and fails when a package's mutation score
 * drops below its baseline floor (`baseline.score - graceMargin`). Stryker
 * itself runs report-only (no `break` threshold in stryker.config.mjs) —
 * the ratchet semantics, grace margin, and config-drift detection live here,
 * mirroring the cpd:check / test:audit pattern:
 *
 *   1. `pnpm --filter @tzurot/<pkg> test:mutation`  → writes reports/mutation/<pkg>/mutation.json
 *   2. `pnpm ops mutation:check`                    → compares against the baseline (CI gate)
 *   3. `pnpm ops mutation:update-baseline`          → sanctioned refresh path
 *
 * The score counts Killed+Timeout as detected and Survived+NoCoverage as
 * undetected — Stryker's own "mutation score" arithmetic. Ignored mutants
 * (the logger-call ignorer) and invalid ones (compile/runtime errors) are
 * excluded from the denominator, so the metric measures only the mutants a
 * test could plausibly kill.
 *
 * Baseline philosophy: baseline-and-hold at the MEASURED score, not a
 * round-number floor. The pilot measured the tuned score in the mid-90s; an
 * aspirational "80%" gate would permit ~15 points of silent regression
 * before CI noticed. The grace margin absorbs equivalent-mutant borderline
 * noise (~0.3 points per mutant at current population size), nothing more.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import {
  buildBaselineMeta,
  checkMetaDrift,
  hashConfigSlice,
  type BaselineMeta,
} from '../audits/baseline-meta.js';
import { emitSummary } from '../audits/summary.js';

/**
 * Bump whenever the measurement-affecting logic changes (score arithmetic,
 * status bucketing, the ignorer contract) — invalidates baselines and forces
 * an explicit `mutation:update-baseline` refresh.
 */
export const MUTATION_IMPL_VERSION = 1;

/**
 * Ignorer plugins the per-package Stryker configs are expected to run with —
 * the UNION across packages (each package runs the subset matching its noise
 * profile: config-resolver runs logger-calls only; cache-invalidation adds
 * observability-options for its logOptions callback plumbing). Part of the
 * config fingerprint: silently dropping an ignorer would change what the
 * score measures, so it must invalidate the baseline.
 */
const EXPECTED_IGNORERS = ['logger-calls', 'observability-options'] as const;

/**
 * Packages under mutation testing. Adding one: give it a stryker.config.mjs
 * + `test:mutation` script (copy config-resolver's), add it here, run its
 * first report, then `pnpm ops mutation:update-baseline` (the fingerprint
 * change forces the refresh anyway).
 */
export const MUTATED_PACKAGES = [
  'config-resolver',
  'cache-invalidation',
  'conversation-history',
] as const;

export const DEFAULT_MUTATION_BASELINE_PATH = '.github/baselines/mutation-baseline.json';

/** Where each package's Stryker JSON report lands (see stryker.config.mjs jsonReporter). */
const REPORTS_ROOT = 'reports/mutation';

/** Default grace margin (score points) for newly-tracked packages. */
const DEFAULT_GRACE_MARGIN = 1;

/** The measurement-affecting config slice — the baseline drift contract. */
export function getMutationConfigFingerprint(): Record<string, unknown> {
  return {
    implVersion: MUTATION_IMPL_VERSION,
    ignorers: [...EXPECTED_IGNORERS],
    packages: [...MUTATED_PACKAGES],
  };
}

/** Subset of Stryker's mutation-testing-report-schema this tool consumes. */
export interface StrykerReport {
  files: Record<string, { mutants: { status: string }[] }>;
}

export interface MutationScoreResult {
  /** Detected / (detected + undetected) × 100, 2dp. 100 when nothing is measurable. */
  score: number;
  /** Killed + Timeout. */
  detected: number;
  /** Survived + NoCoverage. */
  undetected: number;
  /** Excluded from the denominator by ignorer plugins. */
  ignored: number;
  /** CompileError + RuntimeError — invalid mutants, excluded. */
  invalid: number;
}

/** Parse + shape-check a Stryker JSON report file. */
export function loadStrykerReport(path: string): StrykerReport {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    typeof (parsed as Record<string, unknown>).files !== 'object'
  ) {
    throw new Error(`Not a Stryker report (missing "files" object): ${path}`);
  }
  return parsed as StrykerReport;
}

/** Stryker's mutation-score arithmetic over the report's mutant statuses. */
export function computeMutationScore(report: StrykerReport): MutationScoreResult {
  let detected = 0;
  let undetected = 0;
  let ignored = 0;
  let invalid = 0;

  for (const file of Object.values(report.files)) {
    for (const mutant of file.mutants) {
      switch (mutant.status) {
        case 'Killed':
        case 'Timeout':
          detected += 1;
          break;
        case 'Survived':
        case 'NoCoverage':
          undetected += 1;
          break;
        case 'Ignored':
          ignored += 1;
          break;
        default:
          // CompileError / RuntimeError / future statuses: not killable.
          invalid += 1;
          break;
      }
    }
  }

  const totalValid = detected + undetected;
  const score = totalValid === 0 ? 100 : Math.round((detected / totalValid) * 10000) / 100;
  return { score, detected, undetected, ignored, invalid };
}

interface PackageBaseline {
  score: number;
  graceMargin: number;
}

export interface MutationBaseline {
  version: number;
  lastUpdated: string;
  packages: Record<string, PackageBaseline>;
  meta?: BaselineMeta;
  notes?: string;
}

/** Parse + shape-check the baseline file. Throws with a descriptive message. */
export function parseMutationBaseline(raw: string, path: string): MutationBaseline {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`Mutation baseline is not an object: ${path}`);
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.packages === null || typeof obj.packages !== 'object') {
    throw new Error(`Mutation baseline missing "packages" object: ${path}`);
  }
  for (const [name, entry] of Object.entries(obj.packages as Record<string, unknown>)) {
    const pkg = entry as Record<string, unknown> | null;
    if (pkg === null || typeof pkg.score !== 'number' || typeof pkg.graceMargin !== 'number') {
      throw new Error(
        `Mutation baseline package "${name}" needs numeric score+graceMargin: ${path}`
      );
    }
  }
  return obj as unknown as MutationBaseline;
}

export interface MutationCheckOutcome {
  status: 'ok' | 'fail';
  /** Human-readable failure lines (empty when ok). */
  failures: string[];
  /** Per-package evaluation for reporting. */
  packages: {
    name: string;
    score: number | null;
    floor: number;
    baselineScore: number;
  }[];
}

/**
 * Pure ratchet evaluation: every baseline-tracked package must have a score
 * at or above its floor (`baseline.score - graceMargin`). A missing report
 * is a failure — silence must never read as passing.
 */
export function evaluateMutationScores(
  scores: Record<string, MutationScoreResult | null>,
  baseline: MutationBaseline
): MutationCheckOutcome {
  const failures: string[] = [];
  const packages: MutationCheckOutcome['packages'] = [];

  for (const [name, pkgBaseline] of Object.entries(baseline.packages)) {
    const floor = Math.round((pkgBaseline.score - pkgBaseline.graceMargin) * 100) / 100;
    const result = scores[name] ?? null;
    if (result === null) {
      failures.push(
        `${name}: no mutation report found — run \`pnpm --filter @tzurot/${name} test:mutation\` first`
      );
      packages.push({ name, score: null, floor, baselineScore: pkgBaseline.score });
      continue;
    }
    if (result.detected + result.undetected === 0) {
      // A report with nothing measurable is "mutation testing didn't happen"
      // wearing a perfect score — a misconfigured mutate glob or an
      // over-broad ignorer would otherwise pass CI silently at 100.
      failures.push(
        `${name}: report contains no measurable mutants ` +
          `(${result.ignored} ignored, ${result.invalid} invalid) — ` +
          `check the package's mutate glob and the ignorer's scope`
      );
      packages.push({ name, score: null, floor, baselineScore: pkgBaseline.score });
      continue;
    }
    if (result.score < floor) {
      failures.push(
        `${name}: mutation score ${result.score} fell below the floor ${floor} ` +
          `(baseline ${pkgBaseline.score} − grace ${pkgBaseline.graceMargin}); ` +
          `${result.undetected} undetected mutants`
      );
    }
    packages.push({ name, score: result.score, floor, baselineScore: pkgBaseline.score });
  }

  return { status: failures.length === 0 ? 'ok' : 'fail', failures, packages };
}

/** Load each tracked package's report, or null when absent. */
function loadScores(
  packageNames: string[],
  rootDir: string
): Record<string, MutationScoreResult | null> {
  const scores: Record<string, MutationScoreResult | null> = {};
  for (const name of packageNames) {
    const reportPath = resolve(rootDir, REPORTS_ROOT, name, 'mutation.json');
    scores[name] = existsSync(reportPath)
      ? computeMutationScore(loadStrykerReport(reportPath))
      : null;
  }
  return scores;
}

export interface MutationCheckOptions {
  baseline?: string;
  summary?: boolean;
  /** Return instead of setting a failure exit code (canary/test use). */
  noFail?: boolean;
  /** Repo root override for tests/canaries. */
  rootDir?: string;
}

/** CLI shell for `mutation:check`. */
export function runMutationCheck(options: MutationCheckOptions = {}): 'ok' | 'fail' {
  const rootDir = options.rootDir ?? process.cwd();
  const baselinePath = resolve(rootDir, options.baseline ?? DEFAULT_MUTATION_BASELINE_PATH);

  if (!existsSync(baselinePath)) {
    console.error(chalk.red(`✗ Mutation baseline not found: ${baselinePath}`));
    console.error(chalk.dim('Run `pnpm ops mutation:update-baseline` to capture one.'));
    return failOutcome(options, 0, 0);
  }

  const baseline = parseMutationBaseline(readFileSync(baselinePath, 'utf-8'), baselinePath);

  const currentHash = hashConfigSlice(getMutationConfigFingerprint());
  const drift = checkMetaDrift(baseline.meta, currentHash);
  if (!drift.aligned) {
    console.error(chalk.red(`✗ Mutation baseline meta drift: ${drift.detail}`));
    console.error(
      chalk.dim(
        'The baseline was captured under different mutation config. ' +
          'Run `pnpm ops mutation:update-baseline` to refresh.'
      )
    );
    return failOutcome(options, 1, Object.keys(baseline.packages).length);
  }

  const scores = loadScores(Object.keys(baseline.packages), rootDir);
  const outcome = evaluateMutationScores(scores, baseline);

  for (const pkg of outcome.packages) {
    // null = unmeasurable (missing report OR nothing-measurable report) —
    // the specific reason is in the failure lines below.
    const scoreStr = pkg.score === null ? 'unmeasurable' : `${pkg.score}`;
    const line = `  ${pkg.name}: score ${scoreStr} (floor ${pkg.floor}, baseline ${pkg.baselineScore})`;
    console.log(pkg.score !== null && pkg.score >= pkg.floor ? chalk.green(line) : chalk.red(line));
  }

  if (outcome.status === 'fail') {
    console.error(chalk.red.bold('✗ Mutation-score ratchet failed:'));
    for (const failure of outcome.failures) {
      console.error(chalk.red(`   ${failure}`));
    }
    console.error(
      chalk.dim(
        'Either kill the new surviving mutants (see reports/mutation/<pkg>/index.html), or — ' +
          'if the drop is intentional — run `pnpm ops mutation:update-baseline`.'
      )
    );
    return failOutcome(options, outcome.failures.length, Object.keys(baseline.packages).length);
  }

  console.log(chalk.green('✓ Mutation scores at or above baseline floors'));
  if (options.summary === true) {
    emitMutationSummary('ok', 0, Object.keys(baseline.packages).length, currentHash);
  }
  return 'ok';
}

function failOutcome(options: MutationCheckOptions, findings: number, tracked: number): 'fail' {
  if (options.summary === true) {
    emitMutationSummary('fail', findings, tracked, hashConfigSlice(getMutationConfigFingerprint()));
  }
  if (options.noFail !== true) {
    process.exitCode = 1;
  }
  return 'fail';
}

function emitMutationSummary(
  status: 'ok' | 'fail',
  findings: number,
  tracked: number,
  configHash: string
): void {
  emitSummary({
    tool: 'mutation:check',
    status,
    findings,
    baseline: tracked,
    meta: {
      toolVersion: `mutation-check/${MUTATION_IMPL_VERSION}`,
      configHash,
      nodeVersion: process.version,
      generatedAt: new Date().toISOString(),
    },
  });
}

export interface MutationUpdateOptions {
  baseline?: string;
  dryRun?: boolean;
  rootDir?: string;
}

/**
 * Pure computation of the refreshed baseline. Preserves each package's
 * existing graceMargin and the file-level notes/version; overwrites scores,
 * lastUpdated, and meta. Missing reports throw — refreshing a baseline
 * without measurements would silently hold stale floors.
 */
export function computeUpdatedMutationBaseline(
  scores: Record<string, MutationScoreResult | null>,
  previous: Partial<MutationBaseline>,
  meta: BaselineMeta,
  now: Date = new Date()
): MutationBaseline {
  const packages: Record<string, PackageBaseline> = {};
  for (const name of MUTATED_PACKAGES) {
    const result = scores[name];
    if (result === null || result === undefined) {
      throw new Error(
        `Cannot update baseline: no mutation report for "${name}". ` +
          `Run \`pnpm --filter @tzurot/${name} test:mutation\` first.`
      );
    }
    const prevMargin = previous.packages?.[name]?.graceMargin;
    packages[name] = {
      score: result.score,
      graceMargin: typeof prevMargin === 'number' ? prevMargin : DEFAULT_GRACE_MARGIN,
    };
  }

  return {
    ...previous,
    version: typeof previous.version === 'number' ? previous.version : 1,
    lastUpdated: now.toISOString(),
    packages,
    meta,
  };
}

/** CLI shell for `mutation:update-baseline`. */
export function runMutationUpdateBaseline(options: MutationUpdateOptions = {}): void {
  const rootDir = options.rootDir ?? process.cwd();
  const baselinePath = resolve(rootDir, options.baseline ?? DEFAULT_MUTATION_BASELINE_PATH);

  const previous: Partial<MutationBaseline> = existsSync(baselinePath)
    ? parseMutationBaseline(readFileSync(baselinePath, 'utf-8'), baselinePath)
    : {};

  const scores = loadScores([...MUTATED_PACKAGES], rootDir);
  const configHash = hashConfigSlice(getMutationConfigFingerprint());
  const meta = buildBaselineMeta(`mutation-check/${MUTATION_IMPL_VERSION}`, configHash);
  const updated = computeUpdatedMutationBaseline(scores, previous, meta);

  console.log(chalk.bold('Mutation baseline update'));
  for (const [name, pkg] of Object.entries(updated.packages)) {
    const prev = previous.packages?.[name]?.score;
    const deltaStr =
      prev === undefined
        ? chalk.dim('(new)')
        : pkg.score >= prev
          ? chalk.green(`(+${Math.round((pkg.score - prev) * 100) / 100})`)
          : chalk.yellow(`(${Math.round((pkg.score - prev) * 100) / 100})`);
    console.log(`  ${name}: ${pkg.score} ${deltaStr}  grace ${pkg.graceMargin}`);
  }

  if (options.dryRun === true) {
    console.log(chalk.dim('--dry-run: file not written.'));
    return;
  }

  writeFileSync(baselinePath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  console.log(chalk.green(`✓ Baseline written to ${baselinePath}`));
}
