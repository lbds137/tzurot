/**
 * CPD (copy-paste detection) commands.
 *
 * - `cpd:filtered` runs the post-filter against the current jscpd output
 *   and prints the filtered count + breakdown. Use this to inspect what
 *   jscpd is flagging that's actually real debt vs. structural uniformity.
 *
 * - `cpd:check` compares the filtered count against a baseline value and
 *   exits non-zero on regression. Used by CI to enforce the ratchet.
 *
 * - `cpd:update-baseline` writes the current filtered count back to the
 *   baseline file. Used after intentional duplication changes (e.g.,
 *   after a sweep PR that reduces filteredLines, or after deliberately
 *   raising the ratchet to accept new structural-skeleton clones).
 *
 * All three commands assume `pnpm cpd` (or `jscpd --reporters json`) has
 * produced `reports/jscpd/jscpd-report.json` first.
 */

import type { CAC } from 'cac';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { JSCPD_REPORT_PATH, FILTER_IMPL_VERSION } from '../cpd/postFilter.js';
import {
  buildBaselineMeta,
  checkMetaDrift,
  hashConfigSlice,
  type BaselineMeta,
} from '../audits/baseline-meta.js';

/**
 * Returns the measurement-affecting CPD config. Hashed into the baseline
 * `meta.configHash` so a threshold or filter-implementation change
 * invalidates the baseline.
 *
 * `graceMargin` is intentionally NOT in the fingerprint — it's a
 * tolerance setting, not a measurement input. Bumping it doesn't
 * invalidate the underlying line count.
 */
export function getCpdConfigFingerprint(threshold: number): {
  threshold: number;
  filterImplVersion: number;
} {
  return { threshold, filterImplVersion: FILTER_IMPL_VERSION };
}

const DEFAULT_BASELINE_PATH = '.github/baselines/cpd-baseline.json';
const THRESHOLD_OPTION_FLAG = '--threshold <ratio>';

/** Guard against CLI misconfiguration in CI — a degenerate threshold would
 *  silently produce a meaningless filter (≥1 excludes nothing, ≤0 excludes
 *  everything). Fail fast at the boundary instead. Exported for testing. */
export function assertThresholdInRange(threshold: number): void {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    console.error(chalk.red(`--threshold must be between 0.0 and 1.0 (got ${threshold})`));
    process.exit(1);
  }
}

/** Fail loudly if the jscpd report is missing. CI runs `pnpm cpd` with
 *  `continue-on-error: true`, so an upstream jscpd crash leaves the next
 *  step (`cpd:check`) reporting "report not found" while the preceding
 *  step shows green. The supplementary hint points operators at the
 *  preceding step's logs. */
function assertReportExists(): void {
  if (!existsSync(resolve(process.cwd(), JSCPD_REPORT_PATH))) {
    console.error(
      chalk.red(`jscpd report not found at ${JSCPD_REPORT_PATH} — run \`pnpm cpd\` first.`)
    );
    console.error(
      chalk.dim(
        "(In CI: the preceding `pnpm cpd` step may have failed to produce it — check that step's output.)"
      )
    );
    process.exit(1);
  }
}

/** Parse and validate the baseline JSON. A malformed baseline (missing or
 *  non-numeric `filteredLines`) would produce a `NaN` ceiling, and any
 *  `> NaN` comparison is `false` — the ratchet would silently pass even
 *  on regression. Fail loudly at the boundary instead. Exported for testing. */
export function parseBaseline(
  rawContent: string,
  pathForError: string
): { filteredLines: number; graceMargin?: number; meta?: BaselineMeta } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Baseline ${pathForError} is not valid JSON: ${message}`));
    process.exit(1);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.error(chalk.red(`Baseline ${pathForError} must be a JSON object`));
    process.exit(1);
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.filteredLines !== 'number' || !Number.isFinite(obj.filteredLines)) {
    console.error(
      chalk.red(`Baseline ${pathForError} missing required numeric field: filteredLines`)
    );
    process.exit(1);
  }
  if (
    obj.graceMargin !== undefined &&
    (typeof obj.graceMargin !== 'number' || !Number.isFinite(obj.graceMargin))
  ) {
    console.error(
      chalk.red(`Baseline ${pathForError} graceMargin must be a finite number when set`)
    );
    process.exit(1);
  }

  // `meta` is optional — pre-Layer-3 baselines don't have one, and the
  // drift check (in runCheckCommand) treats a missing meta as drift so
  // the operator is forced to refresh and capture metadata.
  let meta: BaselineMeta | undefined;
  if (obj.meta !== undefined) {
    if (typeof obj.meta !== 'object' || obj.meta === null) {
      console.error(chalk.red(`Baseline ${pathForError} meta must be an object when set`));
      process.exit(1);
    }
    const m = obj.meta as Record<string, unknown>;
    // Field-level type check — only validate string-ness; presence is
    // confirmed by the drift check downstream. This keeps parseBaseline
    // focused on JSON shape, not semantic alignment.
    const stringFields: (keyof BaselineMeta)[] = [
      'toolVersion',
      'configHash',
      'nodeVersion',
      'generatedFromSha',
      'generatedAt',
    ];
    for (const field of stringFields) {
      if (typeof m[field] !== 'string') {
        console.error(chalk.red(`Baseline ${pathForError} meta.${field} must be a string`));
        process.exit(1);
      }
    }
    meta = m as unknown as BaselineMeta;
  }

  return { filteredLines: obj.filteredLines, graceMargin: obj.graceMargin, meta };
}

interface FilteredCommandOptions {
  threshold: number;
  showPairs: number;
  json?: boolean;
}

async function runFilteredCommand(options: FilteredCommandOptions): Promise<void> {
  assertThresholdInRange(options.threshold);
  assertReportExists();

  const { filterReport, loadJscpdReport } = await import('../cpd/postFilter.js');
  const report = loadJscpdReport(JSCPD_REPORT_PATH);
  const result = filterReport(report, options.threshold);

  if (options.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(chalk.bold('CPD post-filter results'));
  console.log(`  Raw clones:           ${result.rawCount}`);
  console.log(`  Raw duplicated lines: ${result.rawLines}`);
  console.log(`  Excluded as call-dominant: ${chalk.dim(result.excludedCount)}`);
  console.log(
    `  ${chalk.bold('Filtered count:')}      ${chalk.cyan(result.filteredCount.toString())}`
  );
  console.log(
    `  ${chalk.bold('Filtered lines:')}      ${chalk.cyan(result.filteredLines.toString())}`
  );

  if (result.remainingByPair.length > 0) {
    console.log();
    console.log(chalk.bold(`Top ${options.showPairs} remaining file pairs by lines:`));
    for (const { pair, clones, lines } of result.remainingByPair.slice(0, options.showPairs)) {
      console.log(`  ${chalk.yellow(`${lines}`.padStart(4))} lines, ${clones} clones — ${pair}`);
    }
  }
}

interface CheckCommandOptions {
  baseline: string;
  threshold: number;
}

async function runCheckCommand(options: CheckCommandOptions): Promise<void> {
  assertThresholdInRange(options.threshold);
  assertReportExists();
  if (!existsSync(resolve(process.cwd(), options.baseline))) {
    console.error(chalk.red(`Baseline not found at ${options.baseline}`));
    process.exit(1);
  }

  const { filterReport, loadJscpdReport } = await import('../cpd/postFilter.js');
  const baseline = parseBaseline(
    readFileSync(resolve(process.cwd(), options.baseline), 'utf-8'),
    options.baseline
  );

  // Layer 3 drift detection: hard-fail when the baseline's stored
  // configHash doesn't match the current config. Forces an intentional
  // refresh via `cpd:update-baseline` whenever the threshold or filter
  // implementation changes — without this, a config bump silently makes
  // every subsequent baseline comparison meaningless.
  const currentConfigHash = await hashConfigSlice(getCpdConfigFingerprint(options.threshold));
  const drift = checkMetaDrift(baseline.meta, currentConfigHash);
  if (!drift.aligned) {
    console.error();
    console.error(chalk.red(`❌ CPD baseline meta drift: ${drift.detail}`));
    console.error(
      chalk.dim(
        'The baseline was captured under different CPD config. Run ' +
          '`pnpm ops cpd:update-baseline` to refresh against the current config.'
      )
    );
    process.exit(1);
  }

  const report = loadJscpdReport(JSCPD_REPORT_PATH);
  const result = filterReport(report, options.threshold);

  const grace = baseline.graceMargin ?? 0;
  const ceiling = baseline.filteredLines + grace;

  console.log(chalk.bold('CPD ratchet check'));
  console.log(`  Baseline filtered lines: ${baseline.filteredLines}`);
  console.log(`  Grace margin:            ${grace}`);
  console.log(`  Ceiling:                 ${ceiling}`);
  console.log(`  Current filtered lines:  ${result.filteredLines}`);

  if (result.filteredLines > ceiling) {
    console.error();
    console.error(
      chalk.red(
        `❌ CPD ratchet failed: filtered lines ${result.filteredLines} exceeds ceiling ${ceiling}`
      )
    );
    console.error(
      chalk.dim(
        'Either reduce duplication, or update the baseline if the new clones are intentional.'
      )
    );
    console.error(
      chalk.dim('Run `pnpm ops cpd:filtered --show-pairs 25` to see the top remaining pairs.')
    );
    process.exit(1);
  }

  console.log(chalk.green(`✓ Filtered lines within ceiling`));
}

interface UpdateBaselineCommandOptions {
  baseline: string;
  threshold: number;
  dryRun?: boolean;
}

/** Filter-result subset needed by `computeUpdatedBaseline`. Decoupled from
 *  the full `FilterResult` so tests don't need to construct unused fields. */
interface FilterSummary {
  filteredLines: number;
  filteredCount: number;
  rawLines: number;
  rawCount: number;
}

/** Output of the baseline-update computation. The shell command writes
 *  `updated` to disk (or skips on dry-run) and prints the delta. */
export interface BaselineUpdateResult {
  /** New baseline object — write this back to the file as JSON. */
  updated: Record<string, unknown> & {
    version: number;
    lastUpdated: string;
    filteredLines: number;
    filteredCount: number;
    rawDedupedLines: number;
    rawCount: number;
    threshold: number;
    graceMargin: number;
    meta: BaselineMeta;
  };
  /** Line-count change (positive = baseline raised). */
  delta: number;
  /** Previous filteredLines value (0 if no previous baseline). */
  prevLines: number;
  /** Previous filteredCount value (0 if no previous baseline). */
  prevCount: number;
}

/** Pure computation of the new baseline given the current filter result and
 *  the previous baseline (or `{}` if no previous baseline exists). Preserves
 *  existing fields like `notes`, `version`, `graceMargin` from the previous
 *  baseline; overwrites the count/line fields, `lastUpdated`, and `meta`.
 *  Exported for testing — the wrapping command is a thin I/O shell around this.
 *
 *  `meta` MUST be supplied by the caller (it's tool-specific — the baseline
 *  module doesn't know how to compute the configHash). The caller builds it
 *  via `buildBaselineMeta(toolVersion, configHash)`.
 */
export function computeUpdatedBaseline(
  result: FilterSummary,
  previous: Record<string, unknown>,
  threshold: number,
  meta: BaselineMeta,
  now: Date = new Date()
): BaselineUpdateResult {
  // Narrow `version` and `graceMargin` types before merging — the
  // `previous` Record has `unknown` value type and template-literal
  // logging downstream requires `number` not `unknown`.
  //
  // `version` is the baseline JSON schema version (preserved verbatim),
  // not an update counter. Bump it manually if the JSON shape changes
  // (new required fields, renames, etc.). `lastUpdated` is the
  // "when was this last touched" signal.
  const prevVersion = typeof previous.version === 'number' ? previous.version : 1;
  const prevGraceMargin = typeof previous.graceMargin === 'number' ? previous.graceMargin : 10;
  const prevLines = typeof previous.filteredLines === 'number' ? previous.filteredLines : 0;
  const prevCount = typeof previous.filteredCount === 'number' ? previous.filteredCount : 0;

  const updated = {
    ...previous,
    version: prevVersion,
    lastUpdated: now.toISOString(),
    filteredLines: result.filteredLines,
    filteredCount: result.filteredCount,
    rawDedupedLines: result.rawLines,
    rawCount: result.rawCount,
    threshold,
    graceMargin: prevGraceMargin,
    meta,
  };

  return {
    updated,
    delta: updated.filteredLines - prevLines,
    prevLines,
    prevCount,
  };
}

async function runUpdateBaselineCommand(options: UpdateBaselineCommandOptions): Promise<void> {
  assertThresholdInRange(options.threshold);
  assertReportExists();

  const { filterReport, loadJscpdReport } = await import('../cpd/postFilter.js');
  const report = loadJscpdReport(JSCPD_REPORT_PATH);
  const result = filterReport(report, options.threshold);

  const baselinePath = resolve(process.cwd(), options.baseline);
  // When the baseline already exists, validate it via `parseBaseline` so
  // malformed JSON or missing required fields fail loudly with the same
  // chalk-formatted errors as the rest of the command family. Once
  // validated, re-parse to preserve ALL fields (notes, version, etc.)
  // since `parseBaseline` only surfaces a narrow subset.
  const previous: Record<string, unknown> = existsSync(baselinePath)
    ? (() => {
        const raw = readFileSync(baselinePath, 'utf-8');
        parseBaseline(raw, options.baseline); // exits process on validation failure
        return JSON.parse(raw) as Record<string, unknown>;
      })()
    : {};

  const configHash = await hashConfigSlice(getCpdConfigFingerprint(options.threshold));
  // toolVersion: hard-coded for now; reconsider if this tool's logic
  // starts evolving fast enough that callers need to disambiguate.
  // The configHash captures the measurement-affecting bits anyway.
  const meta = buildBaselineMeta('cpd-check/1.0', configHash);

  const { updated, delta, prevLines, prevCount } = computeUpdatedBaseline(
    result,
    previous,
    options.threshold,
    meta
  );

  const deltaStr =
    delta === 0 ? chalk.dim('±0') : delta < 0 ? chalk.green(`${delta}`) : chalk.yellow(`+${delta}`);

  console.log(chalk.bold('CPD baseline update'));
  console.log(`  Previous filtered lines: ${prevLines}`);
  console.log(`  New filtered lines:      ${updated.filteredLines} (${deltaStr})`);
  console.log(`  Previous filtered count: ${prevCount}`);
  console.log(`  New filtered count:      ${updated.filteredCount}`);
  console.log(`  Grace margin:            ${updated.graceMargin} (preserved)`);

  if (options.dryRun === true) {
    console.log();
    console.log(chalk.dim('--dry-run: file not written.'));
    return;
  }

  writeFileSync(baselinePath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  console.log();
  console.log(chalk.green(`✓ Baseline written to ${options.baseline}`));
  if (delta > 0) {
    console.log(
      chalk.yellow('  Note: this raises the ceiling — make sure the new clones are intentional.')
    );
  }
}

export function registerCpdCommands(cli: CAC): void {
  cli
    .command(
      'cpd:filtered',
      'Run the post-filter against jscpd output (excludes call-dominant fragments)'
    )
    .option(THRESHOLD_OPTION_FLAG, 'Call-ratio threshold (0.0-1.0, default 0.8)', {
      default: 0.8,
    })
    .option('--show-pairs <n>', 'Show top N remaining file pairs by duplicated lines', {
      default: 10,
    })
    .option('--json', 'Emit JSON output instead of human-readable summary')
    .action(runFilteredCommand);

  cli
    .command('cpd:check', 'Fail if filtered CPD count exceeds the baseline (CI gate)')
    .option('--baseline <path>', 'Path to baseline JSON', { default: DEFAULT_BASELINE_PATH })
    .option(THRESHOLD_OPTION_FLAG, 'Call-ratio threshold (default 0.8)', { default: 0.8 })
    .action(runCheckCommand);

  cli
    .command(
      'cpd:update-baseline',
      'Write the current filtered count to the baseline (use after intentional duplication changes)'
    )
    .option('--baseline <path>', 'Path to baseline JSON', { default: DEFAULT_BASELINE_PATH })
    .option(THRESHOLD_OPTION_FLAG, 'Call-ratio threshold (default 0.8)', { default: 0.8 })
    .option('--dry-run', 'Show the diff without writing the file')
    .action(runUpdateBaselineCommand);
}
