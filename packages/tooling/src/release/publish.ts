/**
 * `release:publish` — the version-type-aware tail of the release procedure
 * (tzurot-git-workflow skill steps 7–8), automated so the error-prone flags
 * can't be dropped by a from-memory run.
 *
 * What it does, given a version:
 *  1. Creates (or reuses) an annotated git tag on the target branch and pushes it.
 *  2. Creates the GitHub Release holding the `latest` badge (never `--prerelease`
 *     — the newest release always holds `latest`, stable or beta).
 *  3. **Only for a prerelease-channel version (alpha/beta/rc):** demotes the
 *     immediately-previous tag to `--prerelease`. Creating the new release as
 *     `latest` removes the previous one's badge but leaves it a plain release,
 *     so the flip is required to keep the channel invariant "newest = latest,
 *     every older beta = prerelease". A **stable** (X.Y.Z) release skips the
 *     flip entirely — a GA release doesn't demote its predecessor.
 *
 * CURRENT.md's "Unreleased" reset (skill step 9) stays manual — it needs
 * editorial judgment about what carries forward.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import chalk from 'chalk';

/**
 * The prerelease identifiers where the "newest holds latest, demote the
 * previous" convention applies. Matches a trailing `-alpha` / `-beta` / `-rc`
 * (with or without a numeric suffix). A stable `X.Y.Z` tag has no match.
 */
const PRERELEASE_CHANNEL_RE = /-(?:alpha|beta|rc)(?:[.-]?\d+)?$/i;

export interface PublishOptions {
  /** Path to the release-notes markdown (Conventional-Changelog body). */
  notesFile: string;
  /** Branch the tag/release points at. Default `main`. */
  target?: string;
  /** Print the steps without creating tags/releases or flipping anything. */
  dryRun?: boolean;
}

/** Normalize `3.0.0-beta.155` or `v3.0.0-beta.155` to a `v`-prefixed tag. */
export function toTag(version: string): string {
  return version.startsWith('v') ? version : `v${version}`;
}

/**
 * Guard against publishing an UNFINALIZED or STALE notes file. `existsSync`
 * already catches a mistyped/nonexistent path; this catches the two content
 * misses that path-existence can't:
 *  - `draft-notes` emits `…/compare/vOLD...HEAD` where the human must replace
 *    `HEAD` with the new tag. Publishing with `HEAD` still present means the
 *    finalize step was skipped (a recurring release-notes miss).
 *  - A leftover previous-release notes file names the WRONG new tag in its
 *    compare trailer — the file exists but is stale.
 * Only asserts when a `/compare/…` trailer is present (hand-written notes
 * without one are allowed through — verify-notes covers their PR-ref accuracy).
 */
export function assertNotesFinalized(notes: string, tag: string): void {
  // Anchor to the "**Full Changelog**:" trailer line (05-tooling notes format),
  // not any `/compare/…` substring — a hand-edited note can cite an upstream
  // changelog's compare link, and matching that instead would false-reject.
  const compare = /^\*\*Full Changelog\*\*:.*\/compare\/\S+?\.\.\.(\S+)/m.exec(notes);
  if (compare === null) {
    return;
  }
  // Strip trailing markdown/punctuation without a regex (avoids a ReDoS-shaped
  // super-linear pattern). A tag never ends in `)`, `.`, or `,`, so this only
  // trims trailer noise like a closing paren or sentence period.
  let newRef = compare[1];
  while (newRef.length > 0 && ').,'.includes(newRef[newRef.length - 1])) {
    newRef = newRef.slice(0, -1);
  }
  if (newRef === 'HEAD') {
    throw new Error(
      `Release notes still contain the draft "...HEAD" compare placeholder.\n` +
        `Replace HEAD with the new tag (${tag}) in the "**Full Changelog**" line before publishing.`
    );
  }
  if (newRef !== tag) {
    throw new Error(
      `Release notes compare trailer targets ${newRef}, but you're publishing ${tag}.\n` +
        `This looks like a stale notes file from a previous release — regenerate with ` +
        `pnpm ops release:draft-notes and re-finalize the compare line.`
    );
  }
}

/**
 * True when the version is on the alpha/beta/rc prerelease channel — the only
 * case where the previous release is demoted to `--prerelease`.
 */
export function isPrereleaseVersion(version: string): boolean {
  return PRERELEASE_CHANNEL_RE.test(version);
}

/**
 * The most recent GitHub *release* tag that is NOT `currentTag`. This is the
 * release whose `latest` badge the new one supersedes and, on the prerelease
 * channel, the one that must be flipped to `--prerelease`.
 *
 * Deliberately queries `gh release list` (GitHub's release state — newest
 * first by creation) rather than local `git tag`: `gh release create` mints
 * the new tag *server-side*, so a local repo that hasn't fetched can be one or
 * more tags stale, and demoting a stale "previous" would strand the real
 * current release as a non-latest plain release. The releases live on GitHub;
 * that's the authoritative source for the demote target.
 */
export function findPreviousReleaseTag(currentTag: string): string | null {
  const out = execFileSync(
    'gh',
    ['release', 'list', '--limit', '20', '--json', 'tagName', '--jq', '.[].tagName'],
    { encoding: 'utf-8' }
  );
  const tags = out
    .split('\n')
    .map(t => t.trim())
    .filter(Boolean)
    .filter(t => t !== currentTag);
  return tags[0] ?? null;
}

function run(cmd: string, args: string[], dryRun: boolean): void {
  if (dryRun) {
    console.log(chalk.dim(`  [dry-run] ${cmd} ${args.join(' ')}`));
    return;
  }
  // execFileSync with array args — never string interpolation (00-critical
  // shell-safety: the version/notes-path are external data).
  execFileSync(cmd, args, { encoding: 'utf-8', stdio: 'inherit' });
}

/**
 * Does the tag exist on the REMOTE? Gating tag creation on the local ref is a
 * trap: if `git tag -a` succeeds but the follow-up `git push` fails, the local
 * tag is left behind, and every retry would then see it and skip the push —
 * orphaning an unpushed annotated tag while `gh release create` auto-mints a
 * lightweight one server-side. The remote is the source of truth (same
 * local-vs-remote reasoning as findPreviousReleaseTag). `--exit-code` makes
 * ls-remote exit non-zero when the tag is absent.
 */
function remoteTagExists(tag: string): boolean {
  try {
    execFileSync('git', ['ls-remote', '--exit-code', '--tags', 'origin', tag], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Does a local git tag already exist? (Avoids a re-`tag -a` "already exists" error.) */
function localTagExists(tag: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', `refs/tags/${tag}`], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Does the GitHub Release for this tag already exist? `gh release create` is
 * NOT idempotent — it hard-fails "release already exists" on a re-run. A run
 * that got past create but failed on the demote step (transient `gh` error /
 * rate limit) must be safely retryable, since surviving exactly this
 * partial-failure class is the whole point of the tool.
 */
function releaseExists(tag: string): boolean {
  try {
    execFileSync('gh', ['release', 'view', tag], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Step 7: ensure the annotated tag is on the remote. Idempotent — skip if
 * already published; otherwise create the local tag only if missing (a
 * leftover from a failed-push retry must not re-trigger `tag -a`'s "already
 * exists") and (re)push it.
 */
function ensureTagPushed(tag: string, target: string, dryRun: boolean): void {
  if (remoteTagExists(tag)) {
    console.log(chalk.dim(`  tag ${tag} already on remote — reusing`));
    return;
  }
  if (localTagExists(tag)) {
    console.log(chalk.dim(`  local tag ${tag} exists but is unpushed — pushing`));
  } else {
    // Fetch first and tag `origin/<target>`, not the local branch: a repo that
    // hasn't pulled would otherwise annotate a STALE commit (same
    // source-of-truth-is-remote reasoning as findPreviousReleaseTag — the tool
    // must not depend on the operator remembering to pull first).
    run('git', ['fetch', 'origin', target], dryRun);
    run('git', ['tag', '-a', tag, `origin/${target}`, '-m', `Release ${tag}`], dryRun);
  }
  run('git', ['push', 'origin', tag], dryRun);
}

/**
 * Step 8: create the GitHub Release holding `latest` (never --prerelease — the
 * newest release always holds the latest badge). Idempotent: skip create if
 * the release already exists (a retry after a post-create failure), since
 * `gh release create` hard-fails "already exists" and cannot be re-issued.
 */
function ensureReleaseCreated(
  tag: string,
  target: string,
  notesFile: string,
  dryRun: boolean
): void {
  // `releaseExists` is a read-only `gh release view`, safe to run in dry-run —
  // doing so keeps the preview honest ("would skip create" when it really would).
  if (releaseExists(tag)) {
    console.log(
      chalk.dim(`  release ${tag} already exists — ${dryRun ? 'would skip' : 'skipping'} create`)
    );
    return;
  }
  run(
    'gh',
    [
      'release',
      'create',
      tag,
      '--title',
      tag,
      '--latest',
      '--notes-file',
      notesFile,
      '--target',
      target,
    ],
    dryRun
  );
}

/**
 * Prerelease channel only: demote the immediately-previous release so the
 * newest is the sole `latest` and older betas read `prerelease=true`.
 * Idempotent — `gh release edit --prerelease` on an already-prerelease is a
 * no-op, so a retry is safe.
 *
 * Guards the PREVIOUS release's shape too, not just the current version: if the
 * predecessor is a stable `X.Y.Z` GA build (e.g. publishing `3.1.0-beta.1`
 * right after shipping `3.0.0`), it must NOT be flipped to prerelease — a GA
 * release stays GA. Same "stable is never marked prerelease" rule the
 * current-version gate enforces, applied to the demote target.
 */
function demotePreviousRelease(tag: string, dryRun: boolean): void {
  const prev = findPreviousReleaseTag(tag);
  if (prev === null) {
    console.log(chalk.yellow('  no previous tag found — nothing to demote'));
    return;
  }
  if (!isPrereleaseVersion(prev)) {
    console.log(chalk.dim(`  previous release ${prev} is a stable GA build — not demoting`));
    return;
  }
  run('gh', ['release', 'edit', prev, '--prerelease'], dryRun);
  console.log(chalk.dim(`  ${dryRun ? 'would demote' : 'demoted'} ${prev} → prerelease`));
}

export function publishRelease(version: string, opts: PublishOptions): void {
  const tag = toTag(version);
  const target = opts.target ?? 'main';
  const dryRun = opts.dryRun ?? false;
  const prerelease = isPrereleaseVersion(tag);

  if (!existsSync(opts.notesFile)) {
    throw new Error(
      `Release notes file not found: ${opts.notesFile}\n` +
        `Prepare notes first (e.g. pnpm ops release:draft-notes > notes.md) and pass --notes-file.`
    );
  }
  assertNotesFinalized(readFileSync(opts.notesFile, 'utf-8'), tag);

  console.log(
    chalk.bold(`Publishing ${tag}`) +
      chalk.dim(` (target: ${target}, channel: ${prerelease ? 'prerelease' : 'stable'})`)
  );

  ensureTagPushed(tag, target, dryRun);
  ensureReleaseCreated(tag, target, opts.notesFile, dryRun);
  if (prerelease) {
    demotePreviousRelease(tag, dryRun);
  } else {
    console.log(chalk.dim('  stable release — previous release left untouched (no demote)'));
  }

  if (!dryRun) {
    console.log(chalk.green(`✓ Published ${tag}. Verify:`));
    console.log(
      chalk.dim(
        `  gh release list --limit 5 --json tagName,isPrerelease,isLatest ` +
          `--jq '.[] | {tagName, isPrerelease, isLatest}'`
      )
    );
    console.log(chalk.dim('  Then reset CURRENT.md "Unreleased on Develop" (skill step 9).'));
  }
}
