/**
 * Release-notes git + GitHub helpers
 *
 * Isolated from `notes-format.ts` so the pure formatting logic can be
 * tested without mocking child_process. Everything here shells out.
 */

import { execFileSync } from 'node:child_process';
import type { MergedPr } from './notes-format.js';

/**
 * Return the most recent tag reachable from HEAD. Typical output:
 * `v3.0.0-beta.103`.
 */
export function discoverPrevTag(): string {
  return execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
    encoding: 'utf-8',
  }).trim();
}

/**
 * ISO 8601 timestamp of the commit a tag points at. Used to scope the
 * GitHub `merged:>...` search query.
 */
export function tagTimestamp(tag: string): string {
  return execFileSync('git', ['log', '-1', '--format=%aI', tag], {
    encoding: 'utf-8',
  }).trim();
}

/**
 * List PRs merged into `develop` after `since` (ISO timestamp), sorted
 * chronologically. Uses `gh pr list --search` which queries the GitHub
 * search API — server-side filtering avoids pulling every closed PR.
 *
 * The 200-item limit is intentional: a release that touches more than
 * 200 PRs would be a yearly-scale bundle, well outside the weekly
 * cadence this tool is built for. If we ever hit that cap, we'll see a
 * truncated output and can decide whether to raise the limit or split.
 */
export function listMergedPrsSince(since: string): MergedPr[] {
  const raw = execFileSync(
    'gh',
    [
      'pr',
      'list',
      '--state',
      'merged',
      '--base',
      'develop',
      '--search',
      `merged:>${since}`,
      '--limit',
      '200',
      '--json',
      'number,title,mergedAt',
    ],
    { encoding: 'utf-8' }
  );
  const parsed = JSON.parse(raw) as MergedPr[];
  return parsed.sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));
}
