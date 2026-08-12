/**
 * Uncommitted-tracker-file detection for `pnpm ops backlog`.
 *
 * `backlogLint.ts` parses the tracker store off disk, so a task file that has
 * never been committed passes every structural check — green while invisible
 * to the digest and to every query. This module supplies the advisory warning
 * that closes that gap. It is deliberately NOT a gate: a half-written task
 * file is a legitimate working state.
 *
 * Split out of `backlogLint.ts` on a measurement rather than a hunch — that
 * file had reached exactly 400 counted lines against the 400-line `max-lines`
 * error, so the next edit to it would have failed CI for whoever made it.
 */

import { execFileSync } from 'node:child_process';

/** Entries in `-z` output are NUL-TERMINATED, so the split yields a trailing ''. */
export const PORCELAIN_ENTRY_SEPARATOR = '\0';

/**
 * Bound on the status read, matching `ci-gate.ts`'s shell-out timeouts.
 *
 * `--no-optional-locks` below avoids losing the index-lock race, but that only
 * covers the contended case — a corrupted index, a network-mounted `.git`, or a
 * pathological untracked tree can still stall. This call is synchronous inside
 * `pnpm quality` and the pre-push hook, so an unbounded hang blocks the gate
 * rather than degrading. Bounded, a stall throws and lands in the same `catch`
 * as any other failure: the warning is skipped and nothing else is affected.
 */
export const TRACKER_STATUS_TIMEOUT_MS = 15_000;

/**
 * Read `git status --porcelain -z` for the tracker tree; failure is a normal answer.
 *
 * Every flag here was settled by running the command, not by reading docs:
 *
 * - `-z` is the load-bearing one. Without it git C-quotes and backslash-escapes
 *   any path containing a space — which EVERY `tracker/` filename has, being
 *   `task-N - title.md` — plus non-ASCII bytes under the default `quotePath`,
 *   and the em dash / `→` / `↔` are common in this corpus. With `-z`, entries
 *   are NUL-terminated and git applies no quoting, so nothing downstream has to
 *   unquote or un-escape anything and a raw control byte in a name survives
 *   instead of arriving as `\001`. This replaced a hand-rolled unquoter that
 *   had cost three review rounds and still carried a documented octal-decoding
 *   gap; `-z` removes the gap by removing the encoding.
 *
 * ACCEPTED LIMITATION, at the Node boundary rather than git's: a POSIX filename
 * is a byte string, not necessarily valid UTF-8, and `encoding: 'utf-8'` below
 * makes Node substitute U+FFFD for any invalid sequence. Measured — a file
 * named with a raw `0xFF` byte is emitted by git verbatim and read back as
 * `tracker/bad�name.md`. So "git applies no encoding" is true of git and
 * NOT true end to end. Left as-is deliberately: reading a Buffer would make the
 * round-trip lossless but every consumer (chalk, `console.log`) would then need
 * byte-wise output to print it, and the degradation here is one replacement
 * character in an otherwise-correct path rather than the whole-path mangling
 * the octal case produced. Every file the tracker CLI creates is UTF-8.
 * - `status.renames=false`: with detection on, a staged-rename-then-edited file
 *   is reported as one entry whose "path" is two paths (`old -> new` without
 *   `-z`, two NUL-separated fields with it). Off, the same change is reported
 *   as the `D  old` / `AM new` pair git would otherwise have collapsed —
 *   measured, and the one-path-per-entry consequence is pinned by the
 *   "keeps a filename that itself contains ` -> ` intact" test.
 * - `--no-optional-locks` because plain `status` opportunistically refreshes
 *   the index stat cache and takes `.git/index.lock` to write it back. This
 *   runs inside `pnpm quality` and the pre-push hook alongside husky, and
 *   losing that race would degrade to a silent skip of the warning.
 * - `--untracked-files=all` because the default collapses a wholly-untracked
 *   DIRECTORY into one `?? tracker/newdir/` entry (measured) instead of listing
 *   what is inside it, and this warning's contract is to name the uncommitted
 *   *files*.
 */
export function readTrackerGitStatus(rootDir: string): string | null {
  try {
    return execFileSync(
      'git',
      [
        '--no-optional-locks',
        '-c',
        'status.renames=false',
        'status',
        '--porcelain',
        '-z',
        '--untracked-files=all',
        '--',
        'tracker/',
      ],
      {
        cwd: rootDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: TRACKER_STATUS_TIMEOUT_MS,
      }
    );
  } catch {
    return null;
  }
}

/**
 * Git's seven unmerged (conflict) status pairs. These are matched on BOTH
 * columns, because four of them carry a worktree byte that means something
 * else on its own: `DD`/`UD` look like a plain delete and `AA`/`UA` like a
 * plain add, so a second-column-only lookup mislabels them.
 *
 * `AA` is the one to care about here rather than a curiosity: two branches
 * independently filing a tracker task at the same path produce exactly it,
 * which is the collision TASK-453 is about.
 */
const UNMERGED_STATUS_PAIRS = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/**
 * Worktree-column status byte → what actually happened to the file, for the
 * non-conflict cases. Only bytes git can actually put in that column are
 * listed — no rename/copy entry belongs here (rename detection is off, see
 * `readTrackerGitStatus`), and `A` reaches this column only inside the
 * unmerged pairs above, which are matched before this table is consulted.
 */
const WORKTREE_STATUS_LABELS: Record<string, string> = {
  M: 'modified, not staged',
  D: 'deleted, not staged',
  T: 'type changed, not staged',
};

/**
 * Uncommitted tracker entries, as human-readable warning lines.
 *
 * Each `-z` entry is `XY path`, NUL-terminated. An untracked file (`??`) or a
 * worktree-modified file (`Y` is not a space, e.g. ` M`, ` D`) is invisible to
 * every query until committed — that is what this warns about. A staged-only
 * entry (`Y` is a space, e.g. `A  path`, `M  path`) is about to be committed
 * and is not a warning.
 *
 * The path is taken as-is: `readTrackerGitStatus` passes `-z`, so git
 * applies no quoting or escaping, and it disables rename detection, so an
 * entry is one path and a `" -> "` inside it belongs to somebody's filename.
 * Both rationales live at that function; this one just relies on them.
 * @internal Exported for testing
 */
export function checkUncommittedTrackerFiles(porcelain: string): string[] {
  const warnings: string[] = [];
  for (const line of porcelain.split(PORCELAIN_ENTRY_SEPARATOR)) {
    // Entries are NUL-TERMINATED, so the final split always yields one empty
    // string. That is the only empty an entry can be — git's format is
    // `XY path` — so match it exactly rather than trimming, which would also
    // swallow a malformed whitespace-only entry worth noticing.
    if (line === '') continue;
    const status = line.slice(0, 2);
    const path = line.slice(3);
    if (status === '??') {
      warnings.push(`${path} (untracked)`);
    } else if (UNMERGED_STATUS_PAIRS.has(status)) {
      warnings.push(`${path} (merge conflict)`);
    } else if (status[1] !== ' ') {
      warnings.push(`${path} (${WORKTREE_STATUS_LABELS[status[1]] ?? 'uncommitted change'})`);
    }
  }
  return warnings;
}
