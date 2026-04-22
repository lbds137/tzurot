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
 *
 * Throws a user-facing error if the repo has no tags — `git describe`'s
 * raw stderr is unhelpful for a first-time user of this command.
 */
export function discoverPrevTag(): string {
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(
      'Could not discover a previous tag. Create a release tag first, or pass --from <tag> explicitly.'
    );
  }
}

/**
 * ISO 8601 timestamp of the commit a tag points at. Used to scope the
 * GitHub `merged:>...` search query.
 */
export function tagTimestamp(tag: string): string {
  try {
    return execFileSync('git', ['log', '-1', '--format=%aI', tag], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(
      `Could not resolve timestamp for tag '${tag}'. Does the tag exist? Try 'git tag -l' to see available tags.`
    );
  }
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
 *
 * Throws a user-facing error if `gh` is missing / unauthenticated — the
 * raw `spawnSync` error otherwise exposes internal paths without guidance.
 */
export function listMergedPrsSince(since: string): MergedPr[] {
  let raw: string;
  try {
    raw = execFileSync(
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
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch {
    throw new Error(
      'Failed to query merged PRs. Is `gh` installed and authenticated? Run `gh auth status` to check.'
    );
  }

  // gh can exit 0 while writing an error message to stdout instead of JSON
  // (version drift, transient auth issues). Wrap the parse so the user gets
  // a useful error rather than a bare SyntaxError stack.
  let parsed: MergedPr[];
  try {
    parsed = JSON.parse(raw) as MergedPr[];
  } catch {
    throw new Error(
      `Failed to parse \`gh pr list\` output as JSON. Response was:\n${raw.slice(0, 200)}${raw.length > 200 ? '…' : ''}`
    );
  }

  return parsed.sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));
}
