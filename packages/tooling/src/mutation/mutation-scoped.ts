/**
 * Diff-scoped mutation gate (`ops test:mutation-scoped`) — local assertion-gap finder.
 *
 * Runs Stryker over exactly the source lines a branch's diff adds or changes,
 * making "prove a new assertion can fail" mechanical: a mutant that survives
 * inside the diff's own hunks marks an assertion gap while the diff is still
 * open. This is the per-hunk companion to the whole-package score ratchet
 * (mutation:check) and the CI skip gate (mutation:gate) — neither of which
 * this module touches. Diff parsing and planning live in the
 * mutation-scoped-diff sibling.
 *
 * Invocation shape (verified against Stryker 10's commander-based CLI):
 * all of a package's ranges ride in ONE comma-joined `--mutate` value
 * (`-m 'a,b'`) — the CLI splits that value on commas via createSplitter,
 * while repeated `-m` flags do not collect, so the last flag would win and
 * silently drop every earlier range.
 *
 * A not-covered (NoCoverage) mutant fails the gate just like a survivor: if
 * no test even executes the mutated line, the killing assertion cannot exist.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildPlans,
  isMutationTarget,
  parseGitDiff,
  resolveOwningPackage,
  type PackagePlan,
  type ResolvedFile,
} from './mutation-scoped-diff.js';
import {
  parseTextSummary,
  summarizeReport,
  type MutationSummary,
} from './mutation-scoped-report.js';
import { DEFAULT_BASE } from './mutation-scoped-shared.js';

/** Per-package Stryker outcome. */
export interface PackageResult extends MutationSummary {
  plan: PackagePlan;
  seconds: number;
  error?: string;
}

const SCOPED_CONFIG_NAME = '.stryker-scoped.config.mjs';
/** Report directory parallel to the packages' own `reports/mutation/<pkg>/`. */
const SCOPED_REPORT_DIR = 'mutation-scoped';
/**
 * execFileSync's default maxBuffer is 1 MiB; a year-sized `--base` diff (or a
 * verbose Stryker stdout) overflows it with an opaque ENOBUFS, so both
 * shell-outs carry an explicit roomy cap.
 */
const SHELL_OUT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

// :(glob) is required — without it ** does not match zero directories, so
// src/*.ts files are missed.
// The format-pinning flags hold the output in the `+++ b/` shape parseGitDiff
// matches: git applies explicit flags over diff.noprefix / color /
// external-diff / textconv settings (live-probed with noprefix + color config
// set); if a shape still slips through, the empty-parse backstop in
// planFromDiff fails loudly instead of passing silently.
// Services are out of scope on purpose: no service is Stryker-tracked
// today, and the pathspec (plus writeScopedConfig's ../../ report depth)
// assumes packages/*.
function gitDiffText(base: string): string {
  return execFileSync(
    'git',
    [
      'diff',
      '--unified=0',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      `${base}...HEAD`,
      '--',
      ':(glob)packages/*/src/**/*.ts',
    ],
    { encoding: 'utf-8', maxBuffer: SHELL_OUT_MAX_BUFFER_BYTES }
  );
}

/**
 * True when the raw diff text carries file headers and at least one hunk that
 * adds lines — the shape that must always parse to at least one range.
 * Delete-only diffs (every hunk adds 0 lines) and empty or header-less
 * fragments have no added-line hunks and stay exempt.
 */
function diffHasAddedLineHunks(diffText: string): boolean {
  const lines = diffText.split('\n');
  return (
    lines.some(line => line.includes('diff --git')) &&
    lines.some(line => line.includes('+++') && !line.includes('/dev/null')) &&
    lines.some(line => {
      const match = /\+(\d+)(?:,(\d+))? @@/.exec(line);
      return match !== null && (match[2] === undefined || Number(match[2]) > 0);
    })
  );
}

function planFromDiff(repoRoot: string, base: string): { plans: PackagePlan[]; notes: string[] } {
  const notes: string[] = [];
  const resolved: ResolvedFile[] = [];
  const withoutStryker = new Set<string>();
  const withoutScopedConfig = new Set<string>();
  const diffText = gitDiffText(base);
  const parsed = parseGitDiff(diffText);
  // Backstop for a blinded parse: raw text with file headers and added-line
  // hunks must never parse to zero ranges — that means a git output format
  // defeated the header matching, and failing loudly beats a silent
  // `nothing to mutate` pass (pinned by the noprefix-fixture test).
  if (parsed.size === 0 && diffHasAddedLineHunks(diffText)) {
    throw new Error(
      'git diff text carries file headers and added-line hunks but none parsed — ' +
        'a git output format is blinding the parser (diff.noprefix, color, external/textconv)'
    );
  }
  for (const [file, ranges] of parsed) {
    const owner = resolveOwningPackage(repoRoot, file);
    if (!isMutationTarget(file, owner?.dir)) {
      notes.push(`  • skipped (not mutable source): ${file}`);
      continue;
    }
    if (owner === null) {
      notes.push(`  • skipped (no package manifest): ${file}`);
      continue;
    }
    if (!owner.stryker) {
      withoutStryker.add(owner.name);
      continue;
    }
    if (!existsSync(join(repoRoot, owner.dir, 'stryker.config.mjs'))) {
      withoutScopedConfig.add(owner.name);
      continue;
    }
    resolved.push({ file, packageName: owner.name, packageDir: owner.dir, ranges });
  }
  for (const name of withoutStryker) {
    notes.push(`  • skipped package (no Stryker deps): ${name}`);
  }
  for (const name of withoutScopedConfig) {
    notes.push(
      `  • skipped package (no stryker.config.mjs — not scoped-runnable; ` +
        `use pnpm --filter ${name} test:mutation for a full run)`
    );
  }
  return { plans: buildPlans(resolved), notes };
}

function elapsedSeconds(startedAt: number): number {
  return Math.round(((Date.now() - startedAt) / 1000) * 10) / 10;
}

/**
 * Temp config re-exporting the package's own config with both reporters
 * redirected, so a scoped run cannot overwrite the package's full reports.
 * Deleted after the run on normal and error paths; a hard kill leaves it —
 * gitignored, and the next run overwrites it. Relative fileNames resolve
 * against the package dir (the pnpm exec cwd), matching the package config's
 * `../../reports` convention. Its own tempDirName keeps a scoped run's scratch
 * dir disjoint from a concurrent full run's `.stryker-tmp`.
 */
function writeScopedConfig(repoRoot: string, plan: PackagePlan): string {
  const configPath = join(repoRoot, plan.packageDir, SCOPED_CONFIG_NAME);
  const content = [
    "import config from './stryker.config.mjs';",
    'export default {',
    '  ...config,',
    `  jsonReporter: { fileName: '../../reports/${SCOPED_REPORT_DIR}/${plan.shortName}/mutation.json' },`,
    `  htmlReporter: { fileName: '../../reports/${SCOPED_REPORT_DIR}/${plan.shortName}/index.html' },`,
    "  tempDirName: '.stryker-scoped-tmp',",
    '};',
    '',
  ].join('\n');
  writeFileSync(configPath, content, 'utf-8');
  return configPath;
}

function runPackagePlan(repoRoot: string, plan: PackagePlan): PackageResult {
  const startedAt = Date.now();
  const tempConfigPath = writeScopedConfig(repoRoot, plan);
  const reportPath = join(repoRoot, 'reports', SCOPED_REPORT_DIR, plan.shortName, 'mutation.json');
  let stdout: string;
  try {
    // Delete any previous scoped run's report BEFORE the run: the report is
    // read after it only if THIS run wrote one — a stale report must never
    // masquerade as the result (pinned by the stale-report test).
    rmSync(reportPath, { force: true });
    stdout = execFileSync(
      'pnpm',
      [
        '--filter',
        plan.packageName,
        'exec',
        'stryker',
        'run',
        SCOPED_CONFIG_NAME,
        '-m',
        plan.mutateArg,
        '--allowEmpty',
      ],
      // stdout stays captured for the clear-text fallback; stderr inherits the
      // terminal so the progress reporter is visible during a long scoped run.
      {
        encoding: 'utf-8',
        cwd: repoRoot,
        maxBuffer: SHELL_OUT_MAX_BUFFER_BYTES,
        stdio: ['ignore', 'pipe', 'inherit'],
      }
    );
  } catch (error) {
    return {
      plan,
      seconds: elapsedSeconds(startedAt),
      generated: 0,
      killed: 0,
      survived: 0,
      noCoverage: 0,
      other: 0,
      survivors: [],
      uncovered: [],
      error: (error as Error).message,
    };
  } finally {
    rmSync(tempConfigPath, { force: true });
  }
  const summary = existsSync(reportPath)
    ? summarizeReport(readFileSync(reportPath, 'utf-8'), plan.packageDir)
    : parseTextSummary(stdout);
  // A rowless clear-text summary is a failed Stryker run, not zero mutants —
  // route it through the package error path instead of passing the gate
  // (pinned by the rowless-stdout test).
  if (summary === null) {
    return {
      plan,
      seconds: elapsedSeconds(startedAt),
      generated: 0,
      killed: 0,
      survived: 0,
      noCoverage: 0,
      other: 0,
      survivors: [],
      uncovered: [],
      error: 'no All files summary row in Stryker output (no JSON report was written)',
    };
  }
  return { plan, seconds: elapsedSeconds(startedAt), ...summary };
}

function printResult(result: PackageResult): void {
  if (result.error !== undefined) {
    console.log(
      `  ❌ ${result.plan.packageName}: Stryker failed after ${String(result.seconds)}s — ${result.error}`
    );
    return;
  }
  const outcome = result.survived > 0 || result.noCoverage > 0 ? '✗' : '✓';
  const uncoveredNote = result.noCoverage > 0 ? `, ${String(result.noCoverage)} not covered` : '';
  const otherNote = result.other > 0 ? `, ${String(result.other)} other (timeout/error)` : '';
  console.log(
    `  ${outcome} ${result.plan.packageName}: ${String(result.generated)} mutants — ` +
      `${String(result.killed)} killed, ${String(result.survived)} survived${uncoveredNote}${otherNote} (${String(result.seconds)}s)`
  );
  const at = (location: { file: string; line?: number }): string =>
    location.line === undefined ? location.file : `${location.file}:${String(location.line)}`;
  for (const survivor of result.survivors) {
    console.log(`    ⚠ survivor: ${at(survivor)} — add the killing assertion`);
  }
  for (const location of result.uncovered) {
    console.log(`    ⚠ not covered: ${at(location)} — no test executes this line`);
  }
}

/**
 * Repo-root-relative paths with uncommitted edits among the planned files;
 * empty when the check itself could not run (git unavailable, bad args) — the
 * caller then warns and continues rather than blocking the run. Rename
 * porcelain entries (`R  old -> new`) report only the NEW path, since that is
 * the file whose committed lines Stryker will mutate.
 */
function collectDirtyFiles(plans: PackagePlan[]): string[] {
  try {
    return execFileSync(
      'git',
      ['status', '--porcelain', '--', ...plans.flatMap(plan => plan.files)],
      { encoding: 'utf-8', maxBuffer: SHELL_OUT_MAX_BUFFER_BYTES }
    )
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => {
        const paths = line.slice(3); // strip the two status letters + separator
        const arrow = paths.indexOf(' -> '); // rename entries: `R  old -> new`
        return (arrow === -1 ? paths : paths.slice(arrow + 4)).trim();
      });
  } catch (error) {
    console.error(
      `⚠ could not check the working tree for uncommitted edits: ${(error as Error).message} — continuing`
    );
    return [];
  }
}

export function runMutationScoped(options: { base?: string; dryRun?: boolean } = {}): boolean {
  const base = options.base ?? DEFAULT_BASE;
  const repoRoot = process.cwd();
  let plans: PackagePlan[];
  let notes: string[];
  try {
    ({ plans, notes } = planFromDiff(repoRoot, base));
  } catch (error) {
    console.error(
      `❌ test:mutation-scoped could not diff against ${base}: ${(error as Error).message}`
    );
    return false;
  }
  for (const note of notes) {
    console.log(note);
  }
  if (plans.length === 0) {
    console.log(`✓ No mutable diff lines vs ${base} — nothing to run`);
    return true;
  }
  if (options.dryRun === true) {
    for (const plan of plans) {
      console.log(
        `[dry-run] ${plan.packageName}: ${String(plan.files.length)} file(s), ${String(plan.rangeCount)} range(s)`
      );
      console.log(
        `  pnpm --filter ${plan.packageName} exec stryker run ${SCOPED_CONFIG_NAME} -m '${plan.mutateArg}' --allowEmpty`
      );
    }
    return true;
  }
  const dirty = collectDirtyFiles(plans);
  if (dirty.length > 0) {
    console.error(
      `⚠ working tree has uncommitted edits in planned file(s): ${dirty.join(', ')} — ` +
        'ranges are computed from committed diffs; uncommitted edits shift the lines Stryker mutates'
    );
  }
  let anySurvived = false;
  let anyUncovered = false;
  let anyError = false;
  let killedTotal = 0;
  let otherTotal = 0;
  for (const plan of plans) {
    console.log(
      `▶ ${plan.packageName}: ${String(plan.rangeCount)} range(s) in ${String(plan.files.length)} file(s)`
    );
    const result = runPackagePlan(repoRoot, plan);
    printResult(result);
    killedTotal += result.killed;
    otherTotal += result.other;
    anySurvived = anySurvived || result.survived > 0;
    anyUncovered = anyUncovered || result.noCoverage > 0;
    anyError = anyError || result.error !== undefined;
  }
  if (anyError) {
    console.error('✗ test:mutation-scoped: at least one Stryker run failed');
    return false;
  }
  if (anySurvived) {
    console.log(
      '✗ test:mutation-scoped: a survivor is a signal to inspect, not automatically a defect — ' +
        'log-call mutants are ignored by the ignorer plugin, but other benign survivors exist'
    );
    return false;
  }
  if (anyUncovered) {
    console.log(
      '✗ test:mutation-scoped: not-covered mutants mean no test even executes those lines — ' +
        'the killing assertion cannot exist until a test reaches the code'
    );
    return false;
  }
  if (otherTotal === 0) {
    console.log(`✓ test:mutation-scoped: all ${String(killedTotal)} diff-scoped mutant(s) killed`);
  } else {
    // anyUncovered already returned above, so there is no not-covered count to
    // print here — it would always be 0.
    console.log(
      `✓ test:mutation-scoped: ${String(killedTotal)} killed, ${String(otherTotal)} other (no gate)`
    );
  }
  return true;
}
