/**
 * Measured-ref annotation for the audit-health report.
 *
 * The weekly audit is launched by `schedule:`, which GitHub only fires from
 * the default branch — but a workflow's CHECKOUT ref is independent of its
 * TRIGGER ref, so the tree the report measures need not be the tree that
 * launched it. A report that names no ref invites the reader to assume it
 * measured the branch they are working on, and the ratchet-margin bullets are
 * where that assumption does damage: `lines current: 96/97 (1 headroom, live
 * measure)` reads as one line from the ceiling, while the branch the next PR
 * lands on had 24 lines of room. "live measure" attests that the number was
 * measured, not which tree it was measured against.
 *
 * The annotation is DERIVED from the checkout (git rev-parse / for-each-ref)
 * rather than passed in by the caller, so it cannot drift from what was
 * actually measured — a workflow that changes its checkout ref, or forgets
 * to, self-reports either way.
 */

import { execFileSync } from 'node:child_process';

/** Remote symbolic ref that mirrors the default branch — never a useful label. */
const ORIGIN_HEAD = 'origin/HEAD';

export interface MeasuredRef {
  /** Short commit SHA of the measured tree; null when git is unreadable. */
  sha: string | null;
  /** Remote branches pointing at that commit, e.g. `['origin/develop']`. */
  remoteRefs: string[];
}

/**
 * Run git, returning null for BOTH failure and empty output. Collapsing the
 * two keeps `null` meaning exactly "no answer" — an empty string would satisfy
 * a `!== null` check and reach the formatter as a hole in the annotation.
 */
function git(args: string[], cwd: string): string | null {
  try {
    const output = execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output === '' ? null : output;
  } catch {
    return null;
  }
}

/**
 * Resolve what the current checkout actually is. Remote branches are used
 * rather than `rev-parse --abbrev-ref HEAD` because `actions/checkout` with an
 * explicit `ref:` leaves a detached HEAD, for which that command answers the
 * useless literal `HEAD`.
 */
export function describeMeasuredRef(rootDir: string): MeasuredRef {
  const sha = git(['rev-parse', '--short', 'HEAD'], rootDir);
  const raw = git(
    ['for-each-ref', '--format=%(refname:short)', '--points-at', 'HEAD', 'refs/remotes/origin'],
    rootDir
  );
  const remoteRefs =
    raw === null
      ? []
      : raw
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0 && line !== ORIGIN_HEAD);
  return { sha, remoteRefs };
}

/**
 * One-line annotation for the report header. Degrades rather than lying: an
 * unresolvable ref says so instead of implying a branch.
 */
export function formatMeasuredRef(ref: MeasuredRef): string {
  if (ref.sha === null) {
    return '_Measured: ref unavailable (git not readable)_';
  }
  if (ref.remoteRefs.length === 0) {
    return `_Measured: ${ref.sha} (no matching remote branch)_`;
  }
  return `_Measured: ${ref.remoteRefs.join(', ')} @ ${ref.sha}_`;
}
