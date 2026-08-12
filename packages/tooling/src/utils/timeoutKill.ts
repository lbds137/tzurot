/**
 * Distinguishing a bounded shell-out's TIMEOUT from an ordinary non-zero exit.
 *
 * Why this exists as its own module: adding a `timeout` to an `execFileSync`
 * call replaces "hangs forever" with "throws" — which is an improvement only
 * when the surrounding `catch` treats the throw honestly. Several catches in
 * this package branch on the error's `stdout` content, because a non-zero exit
 * legitimately carries the output they want (`prisma migrate status` exits
 * non-zero precisely when migrations are pending; `grep` exits 1 on no match).
 * A timeout kill lands in that same catch carrying PARTIAL output, so those
 * branches would read it as a real, complete answer and return a confident
 * wrong result instead of an honest "unknown".
 *
 * Measured, not assumed — probing `execFileSync` against a command killed by
 * its own `timeout` option gives:
 *
 *   code    = 'ETIMEDOUT'
 *   signal  = 'SIGTERM'
 *   killed  = undefined      <-- NOT true; a `killed` check never fires
 *   stdout  = whatever was written before the kill
 *
 * `code` is therefore the discriminator. `killed` is the intuitive guess and
 * the wrong one: a guard written against it type-checks, reads correctly, and
 * silently never fires.
 *
 * Both facts above — the populated `stdout` and the undefined `killed` — are
 * pinned by `timeoutKill.test.ts`, which drives a real bounded child rather
 * than a synthetic error fixture, so a Node change that moves them fails the
 * suite instead of quietly disabling this guard.
 */

/**
 * Whether a thrown `execFileSync`/`spawnSync` error is a timeout kill.
 *
 * Call this FIRST in any catch that inspects `stdout`/`stderr` content, and
 * answer "unknown" on true. `getPendingMigrations` (returns `null`) and
 * `fetchRegisteredCommands` (rethrows) are the two shapes that answer takes.
 *
 * Not every site needs this helper: where a catch already discriminates on
 * the exit code, a timeout falls out for free — `hasNonTestImporters` treats
 * only grep's exit 1 as a real no-match, and a timeout carries no `status` at
 * all, so it lands in the "unknown" arm without naming this function.
 */
export function isTimeoutKill(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return (error as { code?: unknown }).code === 'ETIMEDOUT';
}
