/**
 * Automates step 6 of the release flow (rebase develop onto main after a
 * release PR merges). See `.claude/skills/tzurot-git-workflow/SKILL.md`
 * for the release flow context and why skipping this step causes phantom
 * "conflicts with main" on the next release PR.
 */

import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import chalk from 'chalk';

export interface FinalizeOptions {
  dryRun?: boolean;
  yes?: boolean;
}

/**
 * Run a git subcommand with array args (no shell interpolation — see
 * `.claude/rules/00-critical.md` § "Shell Command Safety"). Returns
 * trimmed stdout; throws on non-zero exit.
 */
function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim();
}

/**
 * Execute a git step, or in dry-run mode print what would be executed.
 * Keeps the dry-run branching out of the orchestrator so `finalizeRelease`
 * reads as a linear sequence of steps.
 */
function planStep(args: string[], dryRun: boolean): void {
  if (dryRun) {
    console.log(chalk.dim(`  [dry-run] git ${args.join(' ')}`));
    return;
  }
  git(args);
}

/**
 * Prompt for y/N confirmation interactively. Caller must guarantee a
 * TTY stdin — the non-TTY safety check lives in `shouldProceedWithForcePush`
 * so the error surfaces as a thrown Error (non-zero exit) rather than a
 * silent "returned false → Aborted" that looks like success in CI.
 */
async function confirmInteractively(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${prompt} [y/N] `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

/**
 * Assert tracked files are clean. Uses `--untracked-files=no` so stray
 * untracked files (scratch notes, build artifacts, `.env.local`) don't
 * block the command — git checkout only fails on untracked files when
 * one would collide with a tracked file in the target branch, which is
 * rare and git will refuse loudly if it happens anyway. The 99% case is
 * "untracked file sits there harmlessly," so scoping to tracked-only
 * makes the check match the actual risk surface.
 */
function assertCleanWorkingTree(): void {
  const status = git(['status', '--porcelain', '--untracked-files=no']);
  if (status.length > 0) {
    throw new Error(
      'Working tree has uncommitted tracked changes (staged or unstaged). Commit or stash them before running release:finalize.'
    );
  }
}

/**
 * Count commits that are on `origin/main` but not on `origin/develop`.
 * Zero means develop already contains every main commit — the finalize
 * is a no-op and we can exit early.
 */
function commitsMainAheadOfDevelop(): number {
  const out = git(['rev-list', '--count', 'origin/develop..origin/main']);
  const n = parseInt(out, 10);
  if (Number.isNaN(n)) {
    throw new Error(`Unexpected rev-list output: ${out}`);
  }
  return n;
}

/**
 * Run the rebase step with conflict-safe teardown: if rebase throws, try
 * to `--abort` so the user lands back on develop at the pre-rebase tip,
 * then re-throw the original error. A secondary abort failure is
 * swallowed to avoid clobbering the primary error message.
 */
function rebaseOrAbortCleanly(): void {
  try {
    git(['rebase', 'origin/main']);
  } catch (err) {
    console.error(chalk.red('Rebase failed — aborting to leave develop at original tip.'));
    try {
      git(['rebase', '--abort']);
    } catch {
      // Secondary failure — original error is what matters.
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Decide whether to proceed with the force-push. Three paths:
 *   - `--yes` passed → return true (skip prompt).
 *   - Non-TTY stdin without `--yes` → throw. A caller in CI that forgot
 *     `--yes` must fail loudly (non-zero exit); silently "aborting" would
 *     look like success and mask the missing flag.
 *   - Interactive TTY → prompt for y/N, return the user's answer.
 */
async function shouldProceedWithForcePush(yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    throw new Error('Non-TTY stdin requires --yes. Re-run with --yes to confirm the force-push.');
  }
  return confirmInteractively('This will rebase develop onto main and force-push. Proceed?');
}

/**
 * Return the current branch name, or `''` if git can't resolve it
 * (detached HEAD, missing upstream, etc.). Best-effort — callers treat
 * `''` as "no branch info available" and silently skip downstream uses.
 *
 * Note: `git rev-parse --abbrev-ref HEAD` does NOT throw in detached
 * HEAD state — it outputs the literal string `HEAD`. Translate that to
 * `''` so downstream drift messages don't recommend `git checkout HEAD`
 * (which means something different from "return to your previous branch").
 */
function captureCurrentBranch(): string {
  try {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    return branch === 'HEAD' ? '' : branch;
  } catch {
    return '';
  }
}

/**
 * If an error left us on a different branch than we started on, log a
 * hint so the user can orient themselves quickly. Git's own error
 * messages say nothing about HEAD position, and `git status` after an
 * unexpected failure is easy to miss. Best-effort: rev-parse failures
 * are swallowed so this helper never shadows the primary error.
 */
function reportBranchDrift(startBranch: string): void {
  const currentBranch = captureCurrentBranch();
  if (currentBranch !== '' && currentBranch !== startBranch) {
    console.error(
      chalk.yellow(
        `Note: you started on '${startBranch}' but are now on '${currentBranch}'. ` +
          `Run \`git checkout ${startBranch}\` to return.`
      )
    );
  }
}

/**
 * Check whether main has commits ahead of develop. Returns `'noop'` when
 * develop already contains every main commit (exit early) or `'proceed'`
 * when a rebase is needed. Logs the appropriate status message in both
 * cases — dry-run gets a "(preview, local refs — may be stale)" prefix
 * since `fetch --all` was only printed, not executed.
 */
function checkAheadCount(dryRun: boolean): 'noop' | 'proceed' {
  const ahead = commitsMainAheadOfDevelop();
  if (ahead === 0) {
    console.log(chalk.green('✓ develop already contains every main commit — nothing to finalize'));
    return 'noop';
  }
  const note = dryRun
    ? `(preview, local refs — may be stale) main ahead of develop by ${ahead} commit(s)`
    : `main ahead of develop — rebase needed`;
  console.log(chalk.yellow(note));
  return 'proceed';
}

/**
 * The sequence of writes that the finalize runs (or previews, in dry-run):
 * sync main locally, switch to develop, pull, rebase onto main, force-push.
 *
 * Explicit `origin <branch>` refspecs on pulls avoid depending on upstream
 * tracking being configured (usually is, but a fresh clone or manually-reset
 * branch can be missing the link). Explicit `origin develop` on push guards
 * against the unlikely case where `checkout develop` landed on an unexpected
 * branch — push refuses rather than silently pushing the wrong tracking ref.
 */
function runCheckoutRebasePushSequence(dryRun: boolean): void {
  // Sync main locally. Nice-to-have: keeps the local main pointer matching
  // origin/main; not strictly required since rebase uses the remote-tracking
  // ref directly.
  console.log(chalk.dim('Syncing main...'));
  planStep(['checkout', 'main'], dryRun);
  planStep(['pull', '--ff-only', 'origin', 'main'], dryRun);

  // Switch back to develop and pull. The ff-only pull fails loudly if the
  // local tip has diverged from origin/develop — better than a surprise
  // mid-rebase.
  console.log(chalk.dim('Syncing develop and rebasing onto main...'));
  planStep(['checkout', 'develop'], dryRun);
  planStep(['pull', '--ff-only', 'origin', 'develop'], dryRun);

  // Can't use planStep for rebase: it needs try/catch for --abort teardown
  // on conflicts. Dry-run branch mirrors planStep's output format manually
  // to keep the preview consistent.
  if (dryRun) {
    console.log(chalk.dim('  [dry-run] git rebase origin/main'));
  } else {
    rebaseOrAbortCleanly();
  }

  // Force-push with --force-with-lease (never raw --force) so a concurrent
  // push from someone else refuses instead of clobbering it.
  console.log(chalk.dim('Force-pushing develop...'));
  planStep(['push', '--force-with-lease', 'origin', 'develop'], dryRun);
}

/**
 * Execute or preview the finalize sequence. When `dryRun` is true, all
 * git commands are printed instead of executed — useful for reviewing
 * what the command will do before committing to the force-push.
 */
export async function finalizeRelease(options: FinalizeOptions): Promise<void> {
  const { dryRun = false, yes = false } = options;

  if (!dryRun) {
    assertCleanWorkingTree();
  }

  // Capture the starting branch so we can emit a "you're now on X" hint
  // if any of the checkout/pull steps fail mid-sequence. Skipped in
  // dry-run since no writes happen there.
  const startBranch = dryRun ? '' : captureCurrentBranch();

  console.log(chalk.cyan(dryRun ? '[dry-run] Finalizing release' : 'Finalizing release'));

  // Step 1: fetch. Dry-run prints; real run actually fetches (we need
  // the current remote state for the ahead-count check that follows).
  console.log(chalk.dim('Fetching remote refs...'));
  planStep(['fetch', '--all'], dryRun);

  // Step 2: detect no-op. In dry-run we're reading local refs (fetch
  // was printed, not executed) so the count may be stale — the helper
  // flags that in the status message.
  if (checkAheadCount(dryRun) === 'noop') {
    return;
  }

  // Step 3: confirm the force-push branch. Rebase itself is safe (local
  // only, reversible via --abort); the force-push needs explicit sign-off.
  if (!dryRun && !(await shouldProceedWithForcePush(yes))) {
    console.log(chalk.dim('Aborted by user.'));
    return;
  }

  // Any failure in the checkout/pull/rebase/push dance may have left
  // the user on a different branch than they started on. Log the drift
  // (git's own error says nothing about HEAD) then re-throw to preserve
  // the non-zero exit code. `startBranch` is empty in dry-run, so the
  // hint is skipped there.
  try {
    runCheckoutRebasePushSequence(dryRun);
  } catch (err) {
    if (startBranch !== '') {
      reportBranchDrift(startBranch);
    }
    throw err;
  }

  console.log(
    chalk.green(
      dryRun
        ? '✓ Dry run complete — re-run without --dry-run to apply'
        : '✓ Finalize complete — develop is now SHA-aligned with main'
    )
  );
}
