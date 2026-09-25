/**
 * Make sure `origin/<branch>` exists locally — fetch it when absent (shallow CI checkouts
 * have only the pushed branch). NOTE: an existing-but-STALE ref is used as-is (CI always
 * checks out fresh; locally a stale ref can produce a stale verdict — `git fetch origin
 * <branch>` refreshes it).
 *
 * Shared by `check-workflow-sync.ts` and `main-required-checks.ts` — both guards read a ref
 * off `origin/<branch>` and both run from shallow CI checkouts that may not have it yet.
 */
export function ensureRef(runGit: (args: string[]) => string, branch: string): void {
  try {
    runGit(['rev-parse', '--verify', `origin/${branch}`]);
  } catch {
    runGit(['fetch', 'origin', branch, '--depth=1']);
  }
}
