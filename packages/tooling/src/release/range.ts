/**
 * Ship-inventory: enumerate PRs merged since the previous release tag and
 * classify each as runtime or non-runtime.
 *
 * Reuses the same enumeration path as `release:draft-notes`
 * (`discoverPrevTag` / `tagTimestamp` / `listMergedPrsSince`) so this
 * command can never disagree with the draft-notes PR list — a second,
 * independently-maintained `gh pr list` query is exactly the defect class
 * this command exists to replace (a hand-rolled tag-date window
 * double-counted already-shipped PRs in a live release).
 *
 * Classification follows `.claude/rules/10-working-posture.md` § Ship in
 * bounded units: runtime is everything EXCEPT changes confined to the
 * tooling/test-support packages, `.claude/`, `docs/`, `backlog/`,
 * `tracker/`, `.github/`, and root markdown files. A PR counts as
 * `runtime` the moment ANY changed file falls outside those exclusions.
 */

import chalk from 'chalk';
import {
  discoverPrevTag,
  tagTimestamp,
  listMergedPrsSince,
  DEFAULT_BASE_BRANCH,
} from './github-prs.js';
import type { MergedPr } from './notes-format.js';

export interface RangeOptions {
  /** Previous release tag to diff against. Auto-discovered via `git describe` if omitted. */
  from?: string;
  /** Base branch to query for merged PRs. Defaults to `develop`. */
  base?: string;
}

/**
 * Directory prefixes whose changes never count as "runtime" — tooling,
 * test-support packages, and every documentation/backlog surface. Matched
 * as a path prefix, so `packages/tooling/src/foo.ts` and
 * `packages/tooling/README.md` both match `packages/tooling/`.
 */
const NON_RUNTIME_PREFIXES = [
  'packages/tooling/',
  'packages/test-utils/',
  'packages/test-factories/',
  '.claude/',
  'docs/',
  'backlog/',
  'tracker/',
  '.github/',
  '.husky/',
];

/**
 * A file is non-runtime if it falls under one of `NON_RUNTIME_PREFIXES`,
 * or is a root-level markdown file (`BACKLOG.md`, `CURRENT.md`,
 * `README.md`, ...). Everything else — including root `package.json` /
 * `pnpm-lock.yaml`, which affect every deployed service's build — counts
 * as runtime.
 */
export function isNonRuntimeFile(path: string): boolean {
  if (NON_RUNTIME_PREFIXES.some(prefix => path.startsWith(prefix))) {
    return true;
  }
  // Root-level file: no `/` in the path at all.
  return !path.includes('/') && path.endsWith('.md');
}

/**
 * `gh pr list --json files` truncates the per-PR file list (observed cap:
 * a 166-file PR returned exactly 100 entries). At or past the cap the
 * unseen files could be runtime, so classification fails toward `runtime`
 * — the conservative direction for a release-cadence trigger.
 */
const GH_FILES_LIST_CAP = 100;

/**
 * Classify a PR as `runtime` if ANY changed file falls outside the
 * non-runtime exclusions (or the truncated files list may hide one),
 * `non-runtime` if ALL of them are excluded (or the PR touched no files
 * at all — vacuously true).
 */
export function classifyPr(files: string[] | undefined): 'runtime' | 'non-runtime' {
  const changed = files ?? [];
  // A merged PR with NO reported files is anomalous (a gh hiccup or an empty
  // commit) — the same incomplete-data class as the truncation cap, so it
  // fails the same conservative direction rather than vacuously dropping out
  // of the runtime count.
  if (changed.length === 0 || changed.length >= GH_FILES_LIST_CAP) {
    return 'runtime';
  }
  return changed.every(isNonRuntimeFile) ? 'non-runtime' : 'runtime';
}

export interface RangeReportOptions {
  fromTag: string;
  fromTimestamp: string;
  base: string;
}

/** Threshold at which the trailer suggests proposing a release cut. */
const RUNTIME_CUT_THRESHOLD = 10;

/**
 * Render the deterministic ship-inventory report. Pure function — takes
 * the already-fetched PR list so it's testable without mocking
 * child_process (mirrors `notes-format.ts`'s split from `github-prs.ts`).
 *
 * Sorts by `mergedAt` ascending itself (rather than trusting the caller to
 * have pre-sorted) so the "ordered by mergedAt ascending" output guarantee
 * holds regardless of what order the PR list arrives in.
 */
export function formatRangeReport(prs: MergedPr[], options: RangeReportOptions): string {
  const lines: string[] = [];

  lines.push(`Range: ${options.fromTag} (${options.fromTimestamp}) → ${options.base}`);
  lines.push('');

  const sorted = [...prs].sort(
    (a, b) => new Date(a.mergedAt).getTime() - new Date(b.mergedAt).getTime()
  );

  let runtimeCount = 0;
  for (const pr of sorted) {
    const classification = classifyPr(pr.files);
    if (classification === 'runtime') {
      runtimeCount += 1;
    }
    const date = pr.mergedAt.slice(0, 10);
    lines.push(`#${pr.number}  ${date}  [${classification}]  ${pr.title}`);
  }

  const nonRuntimeCount = prs.length - runtimeCount;
  lines.push('');
  const prNoun = prs.length === 1 ? 'PR' : 'PRs';
  lines.push(
    `Total: ${prs.length} ${prNoun} — ${runtimeCount} runtime, ${nonRuntimeCount} non-runtime`
  );

  if (runtimeCount >= RUNTIME_CUT_THRESHOLD) {
    lines.push(
      `Runtime count at release-cadence threshold (~${RUNTIME_CUT_THRESHOLD}) — consider proposing a cut (.claude/rules/10-working-posture.md § Ship in bounded units).`
    );
  }

  return lines.join('\n');
}

/**
 * Fetch the merged-PR range via the shared `github-prs.ts` helpers and
 * print the ship-inventory report to stdout.
 */
export function releaseRange(options: RangeOptions): void {
  const fromTag = options.from ?? discoverPrevTag();
  const fromTimestamp = tagTimestamp(fromTag);
  const base = options.base ?? DEFAULT_BASE_BRANCH;
  const prs = listMergedPrsSince(fromTimestamp, base);

  if (prs.length === 0) {
    process.stderr.write(chalk.yellow(`No PRs merged since ${fromTag} (${fromTimestamp}).\n`));
  }

  const report = formatRangeReport(prs, { fromTag, fromTimestamp, base });
  process.stdout.write(report);
  process.stdout.write('\n');
}
