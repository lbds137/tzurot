/**
 * Always-Loaded Context Ratchet (audit-class tool)
 *
 * Measures the always-loaded context surfaces — the `.claude/rules/*.md` set
 * (summed) and `CURRENT.md` — on TWO dimensions, and fails when either
 * exceeds its baseline budget.
 *
 * Lines alone is a poor proxy for what these surfaces actually cost, which is
 * context tokens, and the gap is not academic: measured across the ten rules
 * files, density ranges from 44 to 130 chars/line, and `CURRENT.md` runs at
 * ~367. The line ratchet therefore rated `CURRENT.md` "comfortable" at 96/97
 * while it carried a fifth of the entire rules surface's bytes in under a
 * twentieth of its lines — so a reader following the ratchet to find a trim
 * target was sent at the wrong file. Bytes is the honest measurable (exact,
 * deterministic, no tokenizer dependency); the reported token figure is
 * derived from it for readability and nothing gates on the estimate.
 *
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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import {
  buildBaselineMeta,
  checkMetaDrift,
  hashConfigSlice,
  type BaselineMeta,
} from './baseline-meta.js';
import { emitSummary } from './summary.js';

import {
  LINES_IMPL_VERSION,
  DIMENSION_NAMES,
  SURFACE_NAMES,
  SURFACE_GLOBS,
  DEFAULT_GRACE_MARGINS,
  DEFAULT_BYTES_GRACE_MARGINS,
  getLinesConfigFingerprint,
  assertSurfaceName,
  measureSurfaces,
  trackedSurfaceNames,
  type DimensionName,
  type SurfaceName,
  type SurfaceMeasurement,
  type MeasuredSurfaces,
} from './lines-surfaces.js';

/**
 * Bytes per token, for the derived estimate in the report only. Roughly right
 * for English prose and markdown across current tokenizers, and deliberately
 * NOT used by any gate — a threshold resting on a rule of thumb would be a
 * threshold nobody could reason about.
 */
const BYTES_PER_TOKEN_ESTIMATE = 4;

export const DEFAULT_LINES_BASELINE_PATH = '.github/baselines/lines-baseline.json';

interface SurfaceBaseline {
  lines: number;
  graceMargin: number;
  /**
   * Optional in the TYPE only, so a pre-bytes baseline parses and reaches the
   * configHash drift check, which explains the refresh in one sentence. Made
   * required at the parse layer and it would instead throw a shape error that
   * says nothing about what to run.
   */
  bytes?: number;
  bytesGraceMargin?: number;
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
    // Present-but-wrong is a shape error; absent is a pre-bytes baseline, which
    // the drift check reports with a runnable instruction.
    for (const key of ['bytes', 'bytesGraceMargin']) {
      if (surface[key] !== undefined && typeof surface[key] !== 'number') {
        throw new Error(`Lines baseline surface "${name}" has a non-numeric ${key}: ${path}`);
      }
    }
  }
  return obj as unknown as LinesBaseline;
}

export interface DimensionEvaluation {
  dimension: DimensionName;
  /** Measured value; null = not evaluated (see `note` for which class). */
  value: number | null;
  limit: number | null;
  baselineValue: number | null;
  /**
   * Why this dimension was not evaluated, when it wasn't. Carried rather than
   * inferred from which fields are null: THREE distinct classes null all three
   * fields identically (absent from the baseline, not measured by the tool,
   * matched zero files), so a reader deducing the reason from the shape gets
   * the same answer for all of them — and that answer is wrong for two.
   */
  note?: string;
}

export interface LinesCheckOutcome {
  status: 'ok' | 'fail';
  /** Human-readable failure lines (empty when ok). */
  failures: string[];
  /** Per-surface evaluation for reporting, one entry per dimension. */
  surfaces: {
    name: string;
    dimensions: DimensionEvaluation[];
  }[];
}

/**
 * Evaluate ONE dimension of one surface against its baseline entry. Returns
 * the evaluation for reporting plus a failure line, or null when it passed —
 * the caller collects both, so this stays a pure decision with no side effect
 * on the outer accumulator.
 */
function evaluateDimension(
  name: string,
  dimension: DimensionName,
  measurement: SurfaceMeasurement,
  surfaceBaseline: SurfaceBaseline
): { evaluation: DimensionEvaluation; failure: string | null } {
  const baselineValue =
    dimension === 'lines' ? surfaceBaseline.lines : (surfaceBaseline.bytes ?? null);
  const grace =
    dimension === 'lines'
      ? surfaceBaseline.graceMargin
      : (surfaceBaseline.bytesGraceMargin ?? null);
  const value = measurement[dimension];

  if (baselineValue === null || grace === null) {
    // Only reachable when the drift check was bypassed (a hand-written
    // baseline, or a test calling the evaluator directly): an ungated
    // dimension must fail rather than quietly measure nothing.
    return {
      evaluation: {
        dimension,
        value,
        limit: null,
        baselineValue,
        // The FOURTH unevaluated class, and the one not routed through
        // `unmeasurable()` — so it is the one that silently falls back to the
        // generic label unless it carries its own note.
        note: `baseline carries no ${dimension} budget`,
      },
      failure:
        `${name}: baseline carries no ${dimension} budget — ` +
        `refresh via \`pnpm ops lines:update-baseline\``,
    };
  }

  const limit = baselineValue + grace;
  return {
    evaluation: { dimension, value, limit, baselineValue },
    failure:
      value > limit
        ? `${name}: ${value} ${dimension} exceeds the limit ${limit} ` +
          `(baseline ${baselineValue} + grace ${grace}); ` +
          `trim the surface or make growth explicit via \`pnpm ops lines:update-baseline\``
        : null,
  };
}

/**
 * Pure ratchet evaluation: every tracked surface must measure at or below its
 * limit (`baseline + graceMargin`) on EVERY dimension. A surface whose glob
 * matched zero files is a failure — a hollow measurement must never read as
 * "0, under budget."
 *
 * The dimensions are gated independently and both are reported, because that
 * asymmetry is the whole point: a surface can sit comfortably under its line
 * budget while being the heaviest thing loaded, and only naming both numbers
 * makes that visible.
 *
 * Iteration is over the union of the CANONICAL surface set and whatever the
 * baseline happens to hold — not over the baseline alone. A canonical surface
 * with no baseline entry would otherwise be skipped in silence, which is a
 * surface going completely ungated while the report shows nothing missing.
 * That is the same class of invisible hole the byte dimension was added to
 * close, and it is reachable: a scoped refresh against a baseline that never
 * held the other surface writes exactly that state.
 */
export function evaluateSurfaceBudgets(
  measured: MeasuredSurfaces,
  baseline: LinesBaseline
): LinesCheckOutcome {
  const failures: string[] = [];
  const surfaces: LinesCheckOutcome['surfaces'] = [];
  const measuredByName = measured as Record<string, SurfaceMeasurement | undefined>;

  const unmeasurable = (note: string): DimensionEvaluation[] =>
    DIMENSION_NAMES.map(dimension => ({
      dimension,
      value: null,
      limit: null,
      baselineValue: null,
      note,
    }));

  const trackedNames = trackedSurfaceNames(baseline.surfaces);

  for (const name of trackedNames) {
    const surfaceBaseline = baseline.surfaces[name];
    if (surfaceBaseline === undefined) {
      failures.push(
        `${name}: this tool measures a surface the baseline does not track — ` +
          `refresh via \`pnpm ops lines:update-baseline\` (it would otherwise go ungated)`
      );
      surfaces.push({ name, dimensions: unmeasurable('not tracked by the baseline') });
      continue;
    }
    const measurement = measuredByName[name];
    if (measurement === undefined) {
      failures.push(
        `${name}: baseline tracks a surface this tool does not measure — ` +
          `refresh via \`pnpm ops lines:update-baseline\``
      );
      surfaces.push({ name, dimensions: unmeasurable('not measured by this tool') });
      continue;
    }
    if (measurement.fileCount === 0) {
      failures.push(
        `${name}: glob matched zero files — a hollow measurement is not a pass; ` +
          `check that the surface still exists at its expected path`
      );
      surfaces.push({ name, dimensions: unmeasurable('glob matched zero files') });
      continue;
    }

    const dimensions: DimensionEvaluation[] = [];
    for (const dimension of DIMENSION_NAMES) {
      const evaluated = evaluateDimension(name, dimension, measurement, surfaceBaseline);
      dimensions.push(evaluated.evaluation);
      if (evaluated.failure !== null) {
        failures.push(evaluated.failure);
      }
    }
    surfaces.push({ name, dimensions });
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
    // No evaluation happened on this path, so the baseline's own count is the
    // only honest figure available for `tracked`.
    return failOutcome(options, 1, Object.keys(baseline.surfaces).length);
  }

  const measured = measureSurfaces(rootDir);
  const outcome = evaluateSurfaceBudgets(measured, baseline);

  for (const surface of outcome.surfaces) {
    for (const dim of surface.dimensions) {
      console.log(formatDimensionLine(surface.name, dim));
    }
  }

  if (outcome.status === 'fail') {
    console.error(chalk.red.bold('✗ Always-loaded context ratchet failed:'));
    for (const failure of outcome.failures) {
      console.error(chalk.red(`   ${failure}`));
    }
    console.error(
      chalk.dim(
        'Either trim the surface back under its budget, or — if the growth is ' +
          'intentional — run `pnpm ops lines:update-baseline`.'
      )
    );
    return failOutcome(options, outcome.failures.length, outcome.surfaces.length);
  }

  console.log(chalk.green('✓ Always-loaded context surfaces within their budgets'));
  if (options.summary === true) {
    emitLinesSummary('ok', 0, outcome.surfaces.length, currentHash);
  }
  return 'ok';
}

/**
 * One report line per (surface, dimension). The bytes line carries a derived
 * token estimate, because "172579 bytes" is not a quantity anyone can weigh
 * against a session budget while "~43k tokens" is — but the gate compares the
 * bytes, so the estimate can never be the thing that passes or fails a build.
 */
function formatDimensionLine(surfaceName: string, dim: DimensionEvaluation): string {
  const label = `  ${surfaceName}:`.padEnd(12);
  if (dim.value === null || dim.limit === null || dim.baselineValue === null) {
    const detail = dim.note ?? 'not evaluated';
    return chalk.red(`${label} ${dim.dimension}: ${detail}`);
  }
  const estimate =
    dim.dimension === 'bytes'
      ? ` ≈ ${Math.round(dim.value / BYTES_PER_TOKEN_ESTIMATE / 1000)}k est. tokens`
      : '';
  const line =
    `${label} ${dim.value} ${dim.dimension}${estimate} ` +
    `(limit ${dim.limit}, baseline ${dim.baselineValue})`;
  return dim.value <= dim.limit ? chalk.green(line) : chalk.red(line);
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
  /** Refresh only this surface; others keep their recorded numbers verbatim. */
  surface?: string;
}

/**
 * Pure computation of the refreshed baseline. Preserves each surface's
 * existing grace margins and the file-level notes; overwrites the measured
 * counts and meta. A surface whose glob matched zero files throws — refreshing
 * a baseline from a hollow measurement would bless a broken surface path.
 *
 * `onlySurface` exists because the all-or-nothing refresh is not neutral: it
 * ratchets every surface at once, so a refresh wanted for a surface that was
 * TRIMMED also writes a LOOSER budget for one that grew, in a single commit
 * that reads as bookkeeping. That has already happened once — a post-trim
 * refresh would have tightened rules and loosened CURRENT.md together, so it
 * was skipped entirely and the trim went unrecorded. Scoping the write is what
 * makes the tightening safe to run on its own.
 */
export function computeUpdatedLinesBaseline(
  measured: MeasuredSurfaces,
  previous: Partial<LinesBaseline>,
  meta: BaselineMeta,
  onlySurface?: SurfaceName
): LinesBaseline {
  // An UNSCOPED refresh rebuilds from nothing, which is what makes it
  // self-healing: an entry for a surface no longer in SURFACE_NAMES (removed
  // from the set, or hand-added) is pruned rather than carried forward. Only a
  // SCOPED refresh carries the previous entries, because carrying them is its
  // entire purpose — and it carries whatever is there, stray entries included,
  // since it was told to touch exactly one surface and nothing else.
  const surfaces: Record<string, SurfaceBaseline> =
    onlySurface === undefined ? {} : { ...previous.surfaces };
  for (const name of SURFACE_NAMES) {
    if (onlySurface !== undefined && name !== onlySurface) {
      continue;
    }
    const measurement = measured[name];
    if (measurement.fileCount === 0) {
      throw new Error(
        `Cannot update baseline: surface "${name}" matched zero files. ` +
          `Fix the surface path (${SURFACE_GLOBS[name]}) before refreshing.`
      );
    }
    const prev = previous.surfaces?.[name];
    surfaces[name] = {
      lines: measurement.lines,
      graceMargin:
        typeof prev?.graceMargin === 'number' ? prev.graceMargin : DEFAULT_GRACE_MARGINS[name],
      bytes: measurement.bytes,
      bytesGraceMargin:
        typeof prev?.bytesGraceMargin === 'number'
          ? prev.bytesGraceMargin
          : DEFAULT_BYTES_GRACE_MARGINS[name],
    };
  }

  // A scoped refresh still stamps fresh meta, and that is correct rather than
  // sloppy: the meta records the CONFIG the baseline was captured under, not
  // which numbers were rewritten, and the config is identical either way.
  return {
    ...previous,
    surfaces,
    meta,
  };
}

/**
 * A scoped refresh writes only the named surface, so bootstrapping a missing
 * baseline with `--surface` leaves the others untracked. The next `lines:check`
 * does catch it — but one command later, and by then the operator has already
 * seen a clean "✓ Baseline written". Warn at the point of the mistake instead.
 */
function warnIfScopedRefreshLeavesGaps(
  onlySurface: SurfaceName | undefined,
  previous: Partial<LinesBaseline>
): void {
  if (onlySurface === undefined) {
    return;
  }
  const missing = SURFACE_NAMES.filter(
    name => name !== onlySurface && previous.surfaces?.[name] === undefined
  );
  if (missing.length === 0) {
    return;
  }
  console.warn(
    chalk.yellow(
      `⚠ Scoped refresh: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not ` +
        `in the baseline and will stay untracked. Run \`pnpm ops lines:update-baseline\` ` +
        `without --surface to capture everything.`
    )
  );
}

/** Signed delta against the previous baseline value, or `(new)` when absent. */
function formatDelta(value: number, previous: number | undefined): string {
  if (previous === undefined) {
    return chalk.dim('(new)');
  }
  return value <= previous
    ? chalk.green(`(${value - previous})`)
    : chalk.yellow(`(+${value - previous})`);
}

/** CLI shell for `lines:update-baseline`. */
export function runLinesUpdateBaseline(options: LinesUpdateOptions = {}): void {
  const rootDir = options.rootDir ?? process.cwd();
  const baselinePath = resolve(rootDir, options.baseline ?? DEFAULT_LINES_BASELINE_PATH);

  const previous: Partial<LinesBaseline> = existsSync(baselinePath)
    ? parseLinesBaseline(readFileSync(baselinePath, 'utf-8'), baselinePath)
    : {};

  const onlySurface =
    options.surface === undefined ? undefined : assertSurfaceName(options.surface);

  warnIfScopedRefreshLeavesGaps(onlySurface, previous);

  const measured = measureSurfaces(rootDir);
  const configHash = hashConfigSlice(getLinesConfigFingerprint());
  const meta = buildBaselineMeta(`lines-check/${LINES_IMPL_VERSION}`, configHash);
  const updated = computeUpdatedLinesBaseline(measured, previous, meta, onlySurface);

  console.log(
    chalk.bold(
      onlySurface === undefined
        ? 'Lines baseline update'
        : `Lines baseline update — ${onlySurface} only`
    )
  );
  for (const [name, surface] of Object.entries(updated.surfaces)) {
    if (onlySurface !== undefined && name !== onlySurface) {
      // A scoped refresh against a pre-bytes baseline leaves untouched surfaces
      // with no byte budget at all, and the next `lines:check` will say so.
      // Report that honestly here rather than printing a fabricated number.
      const carried = surface.bytes === undefined ? 'no byte budget' : `${surface.bytes} bytes`;
      console.log(chalk.dim(`  ${name}: unchanged (${surface.lines} lines, ${carried})`));
      continue;
    }
    const prev = previous.surfaces?.[name];
    const bytes = measured[assertSurfaceName(name)].bytes;
    console.log(
      `  ${name}: ${surface.lines} lines ${formatDelta(surface.lines, prev?.lines)}  ` +
        `grace ${surface.graceMargin}`
    );
    console.log(
      `  ${' '.repeat(name.length)}  ${bytes} bytes ` +
        `${formatDelta(bytes, prev?.bytes)}  grace ${surface.bytesGraceMargin}`
    );
  }

  if (options.dryRun === true) {
    console.log(chalk.dim('--dry-run: file not written.'));
    return;
  }

  writeFileSync(baselinePath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  console.log(chalk.green(`✓ Baseline written to ${baselinePath}`));
}
