/**
 * Always-Loaded Context Line Ratchet (audit-class tool)
 *
 * Measures the line count of the always-loaded context surfaces — the
 * `.claude/rules/*.md` set (summed) and `CURRENT.md` — and fails when a
 * surface exceeds its baseline budget (`baseline.lines + graceMargin`).
 * Mirrors the mutation:check / cpd:check ratchet pattern:
 *
 *   1. `pnpm ops lines:check`            → compares against the baseline (CI gate)
 *   2. `pnpm ops lines:update-baseline`  → sanctioned refresh path
 *
 * These surfaces are paid on every session start: every line of rules and
 * CURRENT.md is context loaded before any work happens. They historically
 * bloat through doc-only commits that skip the heavy checks, so this ratchet
 * runs on the cheap paths too (docs-only pre-push, `pnpm quality`, CI lint).
 *
 * Baseline philosophy: baseline-and-hold at the MEASURED count. Growth is a
 * conscious decision (an explicit `lines:update-baseline` visible in review),
 * never drift. The grace margin absorbs legitimate small additions between
 * refreshes, nothing more.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
 * Bump whenever the measurement-affecting logic changes (line-count
 * arithmetic, surface globs, surface set) — invalidates baselines and forces
 * an explicit `lines:update-baseline` refresh.
 */
export const LINES_IMPL_VERSION = 1;

/** The tracked surfaces, in stable order (part of the config fingerprint). */
export const SURFACE_NAMES = ['rules', 'current'] as const;
export type SurfaceName = (typeof SURFACE_NAMES)[number];

/**
 * What each surface measures. Two glob shapes are supported — a literal
 * file path, or a single-directory `<dir>/*.md` — because that's all the
 * always-loaded surfaces need. Not a general glob engine, on purpose.
 */
const SURFACE_GLOBS: Record<SurfaceName, string> = {
  rules: '.claude/rules/*.md',
  current: 'CURRENT.md',
};

export const DEFAULT_LINES_BASELINE_PATH = '.github/baselines/lines-baseline.json';

/**
 * Default grace margins (lines) for newly-tracked surfaces. Sized to absorb
 * legitimate small additions between baseline refreshes: ~150 lines across
 * the ten rules files is one modest new section; ~60 lines keeps CURRENT.md
 * near its session-status cap.
 */
const DEFAULT_GRACE_MARGINS: Record<SurfaceName, number> = {
  rules: 150,
  current: 60,
};

/** The measurement-affecting config slice — the baseline drift contract. */
export function getLinesConfigFingerprint(): Record<string, unknown> {
  return {
    implVersion: LINES_IMPL_VERSION,
    surfaces: [...SURFACE_NAMES],
    globs: {
      rules: SURFACE_GLOBS.rules,
      current: SURFACE_GLOBS.current,
    },
  };
}

export interface SurfaceMeasurement {
  /** Sum of line counts across every file the surface's glob matched. */
  lines: number;
  /**
   * How many files matched. Zero is the hollow-measurement signal: the
   * surface "measures" 0 lines only because nothing was found — a moved
   * directory or renamed file must fail loudly, never pass at 0.
   */
  fileCount: number;
}

export type MeasuredSurfaces = Record<SurfaceName, SurfaceMeasurement>;

/**
 * `wc -l`-compatible line count: number of newline-terminated lines, with a
 * final unterminated line still counting as one. Empty file = 0.
 */
export function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  const segments = content.split('\n');
  return segments[segments.length - 1] === '' ? segments.length - 1 : segments.length;
}

/** Expand one of the two supported glob shapes into absolute file paths. */
function matchSurfaceFiles(rootDir: string, glob: string): string[] {
  const dirGlobSuffix = '/*.md';
  if (glob.endsWith(dirGlobSuffix)) {
    const dir = join(rootDir, glob.slice(0, -dirGlobSuffix.length));
    try {
      return readdirSync(dir)
        .filter(name => name.endsWith('.md'))
        .sort()
        .map(name => join(dir, name));
    } catch {
      // Missing directory = zero matches; the evaluator turns that into a
      // hollow-measurement failure rather than a silent 0-line pass.
      return [];
    }
  }
  const file = join(rootDir, glob);
  return existsSync(file) ? [file] : [];
}

/** Measure every tracked surface under `rootDir`. */
export function measureSurfaces(rootDir: string): MeasuredSurfaces {
  const measured = {} as MeasuredSurfaces;
  for (const name of SURFACE_NAMES) {
    const files = matchSurfaceFiles(rootDir, SURFACE_GLOBS[name]);
    let lines = 0;
    for (const file of files) {
      lines += countLines(readFileSync(file, 'utf-8'));
    }
    measured[name] = { lines, fileCount: files.length };
  }
  return measured;
}

interface SurfaceBaseline {
  lines: number;
  graceMargin: number;
}

export interface LinesBaseline {
  surfaces: Record<string, SurfaceBaseline>;
  meta?: BaselineMeta;
  notes?: string;
}

/** Parse + shape-check the baseline file. Throws with a descriptive message. */
export function parseLinesBaseline(raw: string, path: string): LinesBaseline {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`Lines baseline is not an object: ${path}`);
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.surfaces === null || typeof obj.surfaces !== 'object') {
    throw new Error(`Lines baseline missing "surfaces" object: ${path}`);
  }
  for (const [name, entry] of Object.entries(obj.surfaces as Record<string, unknown>)) {
    const surface = entry as Record<string, unknown> | null;
    if (
      surface === null ||
      typeof surface.lines !== 'number' ||
      typeof surface.graceMargin !== 'number'
    ) {
      throw new Error(`Lines baseline surface "${name}" needs numeric lines+graceMargin: ${path}`);
    }
  }
  return obj as unknown as LinesBaseline;
}

export interface LinesCheckOutcome {
  status: 'ok' | 'fail';
  /** Human-readable failure lines (empty when ok). */
  failures: string[];
  /** Per-surface evaluation for reporting. */
  surfaces: {
    name: string;
    /** Measured line count; null = unmeasurable (glob matched zero files). */
    lines: number | null;
    limit: number;
    baselineLines: number;
  }[];
}

/**
 * Pure ratchet evaluation: every baseline-tracked surface must measure at or
 * below its limit (`baseline.lines + graceMargin`). A surface whose glob
 * matched zero files is a failure — a hollow measurement must never read as
 * "0 lines, under budget."
 */
export function evaluateLineBudgets(
  measured: MeasuredSurfaces,
  baseline: LinesBaseline
): LinesCheckOutcome {
  const failures: string[] = [];
  const surfaces: LinesCheckOutcome['surfaces'] = [];
  const measuredByName = measured as Record<string, SurfaceMeasurement | undefined>;

  for (const [name, surfaceBaseline] of Object.entries(baseline.surfaces)) {
    const limit = surfaceBaseline.lines + surfaceBaseline.graceMargin;
    const measurement = measuredByName[name];
    if (measurement === undefined) {
      failures.push(
        `${name}: baseline tracks a surface this tool does not measure — ` +
          `refresh via \`pnpm ops lines:update-baseline\``
      );
      surfaces.push({ name, lines: null, limit, baselineLines: surfaceBaseline.lines });
      continue;
    }
    if (measurement.fileCount === 0) {
      failures.push(
        `${name}: glob matched zero files — a hollow measurement is not a pass; ` +
          `check that the surface still exists at its expected path`
      );
      surfaces.push({ name, lines: null, limit, baselineLines: surfaceBaseline.lines });
      continue;
    }
    if (measurement.lines > limit) {
      failures.push(
        `${name}: ${measurement.lines} lines exceeds the limit ${limit} ` +
          `(baseline ${surfaceBaseline.lines} + grace ${surfaceBaseline.graceMargin}); ` +
          `trim the surface or make growth explicit via \`pnpm ops lines:update-baseline\``
      );
    }
    surfaces.push({
      name,
      lines: measurement.lines,
      limit,
      baselineLines: surfaceBaseline.lines,
    });
  }

  return { status: failures.length === 0 ? 'ok' : 'fail', failures, surfaces };
}

export interface LinesCheckOptions {
  baseline?: string;
  summary?: boolean;
  /** Return instead of setting a failure exit code (canary/test use). */
  noFail?: boolean;
  /** Repo root override for tests/canaries. */
  rootDir?: string;
}

/** CLI shell for `lines:check`. */
export function runLinesCheck(options: LinesCheckOptions = {}): 'ok' | 'fail' {
  const rootDir = options.rootDir ?? process.cwd();
  const baselinePath = resolve(rootDir, options.baseline ?? DEFAULT_LINES_BASELINE_PATH);

  if (!existsSync(baselinePath)) {
    console.error(chalk.red(`✗ Lines baseline not found: ${baselinePath}`));
    console.error(chalk.dim('Run `pnpm ops lines:update-baseline` to capture one.'));
    return failOutcome(options, 0, 0);
  }

  const baseline = parseLinesBaseline(readFileSync(baselinePath, 'utf-8'), baselinePath);

  const currentHash = hashConfigSlice(getLinesConfigFingerprint());
  const drift = checkMetaDrift(baseline.meta, currentHash);
  if (!drift.aligned) {
    console.error(chalk.red(`✗ Lines baseline meta drift: ${drift.detail}`));
    console.error(
      chalk.dim(
        'The baseline was captured under different surface config. ' +
          'Run `pnpm ops lines:update-baseline` to refresh.'
      )
    );
    return failOutcome(options, 1, Object.keys(baseline.surfaces).length);
  }

  const measured = measureSurfaces(rootDir);
  const outcome = evaluateLineBudgets(measured, baseline);

  for (const surface of outcome.surfaces) {
    const linesStr = surface.lines === null ? 'unmeasurable' : `${surface.lines}`;
    const line = `  ${surface.name}: ${linesStr} lines (limit ${surface.limit}, baseline ${surface.baselineLines})`;
    console.log(
      surface.lines !== null && surface.lines <= surface.limit ? chalk.green(line) : chalk.red(line)
    );
  }

  if (outcome.status === 'fail') {
    console.error(chalk.red.bold('✗ Always-loaded context line ratchet failed:'));
    for (const failure of outcome.failures) {
      console.error(chalk.red(`   ${failure}`));
    }
    console.error(
      chalk.dim(
        'Either trim the surface back under its budget, or — if the growth is ' +
          'intentional — run `pnpm ops lines:update-baseline`.'
      )
    );
    return failOutcome(options, outcome.failures.length, Object.keys(baseline.surfaces).length);
  }

  console.log(chalk.green('✓ Always-loaded context surfaces within their line budgets'));
  if (options.summary === true) {
    emitLinesSummary('ok', 0, Object.keys(baseline.surfaces).length, currentHash);
  }
  return 'ok';
}

function failOutcome(options: LinesCheckOptions, findings: number, tracked: number): 'fail' {
  if (options.summary === true) {
    emitLinesSummary('fail', findings, tracked, hashConfigSlice(getLinesConfigFingerprint()));
  }
  if (options.noFail !== true) {
    process.exitCode = 1;
  }
  return 'fail';
}

function emitLinesSummary(
  status: 'ok' | 'fail',
  findings: number,
  tracked: number,
  configHash: string
): void {
  emitSummary({
    tool: 'lines:check',
    status,
    findings,
    baseline: tracked,
    meta: {
      toolVersion: `lines-check/${LINES_IMPL_VERSION}`,
      configHash,
      nodeVersion: process.version,
      generatedAt: new Date().toISOString(),
    },
  });
}

export interface LinesUpdateOptions {
  baseline?: string;
  dryRun?: boolean;
  rootDir?: string;
}

/**
 * Pure computation of the refreshed baseline. Preserves each surface's
 * existing graceMargin and the file-level notes; overwrites line counts and
 * meta. A surface whose glob matched zero files throws — refreshing a
 * baseline from a hollow measurement would bless a broken surface path.
 */
export function computeUpdatedLinesBaseline(
  measured: MeasuredSurfaces,
  previous: Partial<LinesBaseline>,
  meta: BaselineMeta
): LinesBaseline {
  const surfaces: Record<string, SurfaceBaseline> = {};
  for (const name of SURFACE_NAMES) {
    const measurement = measured[name];
    if (measurement.fileCount === 0) {
      throw new Error(
        `Cannot update baseline: surface "${name}" matched zero files. ` +
          `Fix the surface path (${SURFACE_GLOBS[name]}) before refreshing.`
      );
    }
    const prevMargin = previous.surfaces?.[name]?.graceMargin;
    surfaces[name] = {
      lines: measurement.lines,
      graceMargin: typeof prevMargin === 'number' ? prevMargin : DEFAULT_GRACE_MARGINS[name],
    };
  }

  return {
    ...previous,
    surfaces,
    meta,
  };
}

/** CLI shell for `lines:update-baseline`. */
export function runLinesUpdateBaseline(options: LinesUpdateOptions = {}): void {
  const rootDir = options.rootDir ?? process.cwd();
  const baselinePath = resolve(rootDir, options.baseline ?? DEFAULT_LINES_BASELINE_PATH);

  const previous: Partial<LinesBaseline> = existsSync(baselinePath)
    ? parseLinesBaseline(readFileSync(baselinePath, 'utf-8'), baselinePath)
    : {};

  const measured = measureSurfaces(rootDir);
  const configHash = hashConfigSlice(getLinesConfigFingerprint());
  const meta = buildBaselineMeta(`lines-check/${LINES_IMPL_VERSION}`, configHash);
  const updated = computeUpdatedLinesBaseline(measured, previous, meta);

  console.log(chalk.bold('Lines baseline update'));
  for (const [name, surface] of Object.entries(updated.surfaces)) {
    const prev = previous.surfaces?.[name]?.lines;
    const deltaStr =
      prev === undefined
        ? chalk.dim('(new)')
        : surface.lines <= prev
          ? chalk.green(`(${surface.lines - prev})`)
          : chalk.yellow(`(+${surface.lines - prev})`);
    console.log(`  ${name}: ${surface.lines} lines ${deltaStr}  grace ${surface.graceMargin}`);
  }

  if (options.dryRun === true) {
    console.log(chalk.dim('--dry-run: file not written.'));
    return;
  }

  writeFileSync(baselinePath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  console.log(chalk.green(`✓ Baseline written to ${baselinePath}`));
}
