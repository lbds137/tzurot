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
 * ISO 8601 creation timestamp of a tag. Used to scope the GitHub
 * `merged:>...` search query.
 *
 * Uses `%(creatordate:iso-strict)` which returns:
 * - tagger date for annotated tags
 * - committer date of the target commit for lightweight tags
 *
 * This is the correct scope boundary for "PRs merged since the previous
 * release." Using `git log -1 --format=%aI` (author date) would miss PRs
 * merged between commit-authored-time and tag-creation-time on annotated
 * tags — a real issue when tags are cut hours or days after the final
 * commit is authored.
 */
export function tagTimestamp(tag: string): string {
  const notFoundMessage = `Could not resolve timestamp for tag '${tag}'. Does the tag exist? Try 'git tag -l' to see available tags.`;

  let result: string;
  try {
    result = execFileSync(
      'git',
      ['for-each-ref', '--format=%(creatordate:iso-strict)', `refs/tags/${tag}`],
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    ).trim();
  } catch {
    throw new Error(notFoundMessage);
  }

  // `git for-each-ref refs/tags/<nonexistent>` exits 0 with empty stdout —
  // it doesn't throw. Empty-string guard catches the missing-tag case that
  // the try/catch above cannot.
  if (result === '') {
    throw new Error(notFoundMessage);
  }
  return result;
}

/**
 * Default base branch for PR queries. Matches the repo's current
 * develop-as-integration-branch workflow; override via the `base`
 * parameter of `listMergedPrsSince` if the target branch is different
 * (e.g., fork with a different default, or main-branch workflow).
 */
export const DEFAULT_BASE_BRANCH = 'develop';

/**
 * List PRs merged into `base` after `since` (ISO timestamp), sorted
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
export function listMergedPrsSince(since: string, base: string = DEFAULT_BASE_BRANCH): MergedPr[] {
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
        base,
        '--search',
        `merged:>${since}`,
        '--limit',
        '200',
        '--json',
        'number,title,mergedAt,files',
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Failed to parse \`gh pr list\` output as JSON. Response was:\n${raw.slice(0, 200)}${raw.length > 200 ? '…' : ''}`
    );
  }

  // Shape guard: a transient GraphQL failure can produce a non-array JSON
  // object (e.g., `{"errors": [...]}`) that parses successfully but would
  // throw an unhelpful "sort is not a function" downstream. Fail early
  // with the offending payload quoted.
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Expected a JSON array from \`gh pr list\`, got ${typeof parsed}. Response was:\n${raw.slice(0, 200)}${raw.length > 200 ? '…' : ''}`
    );
  }

  return (parsed as RawGhPr[])
    .map(normalizeGhPr)
    .sort((a, b) => new Date(a.mergedAt).getTime() - new Date(b.mergedAt).getTime());
}

/**
 * Raw shape of one `gh pr list --json number,title,mergedAt,files` element.
 * `files` entries carry `path` + line-change counts; only `path` is used
 * downstream (release:range classification), so the rest is discarded in
 * `normalizeGhPr`.
 */
interface RawGhPr {
  number: number;
  title: string;
  mergedAt: string;
  files?: { path: string }[];
}

/** Flatten `gh`'s `files: [{path, additions, deletions}]` down to `files: string[]`. */
function normalizeGhPr(raw: RawGhPr): MergedPr {
  return {
    number: raw.number,
    title: raw.title,
    mergedAt: raw.mergedAt,
    files: raw.files?.map(f => f.path),
  };
}

/**
 * Count files in the whole-range diff (`<tag>..<base>`), which is what the
 * release PR will render. Distinct from the per-PR file lists used for
 * runtime classification: those measure prod risk, this measures how much
 * diff the release reviewer has to read.
 *
 * Rename handling matches GitHub's, which is worth stating because the
 * opposite was assumed here first: `diff.renames` defaults to TRUE (Git 2.9+)
 * and this repo sets no override, so a pure rename is ONE entry — the new
 * path — not a delete plus an add. Probed rather than reasoned: a scratch
 * repo with a single `git mv` returns 1 path from `--name-only`, identical
 * with and without an explicit `-M`.
 *
 * The two-dot form assumes `fromTag` is an ancestor of `base`. That holds
 * because `release:finalize` rebases `develop` onto `main` after every
 * release, keeping tags reachable. If it were ever broken — a hotfix landing
 * on `main` outside that flow — the count would OVER-state relative to what
 * GitHub renders, never under, so the advisory still fails toward warning
 * early.
 *
 * Returns `undefined` rather than throwing when git can't answer (a missing
 * tag, a shallow clone, no such ref) — the ship inventory is still useful
 * without a size line, and this command runs at release time where failing
 * the whole report over an advisory metric would be the wrong trade.
 */
export function countRangeChangedFiles(fromTag: string, base: string): number | undefined {
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${fromTag}..${base}`], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const trimmed = out.trim();
    // An empty diff is a legitimate zero, not a failure — `split` on '' would
    // otherwise report 1.
    return trimmed === '' ? 0 : trimmed.split('\n').length;
  } catch {
    return undefined;
  }
}
