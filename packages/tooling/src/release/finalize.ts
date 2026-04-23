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
 * Prompt for y/N confirmation. Returns false on non-TTY stdin so
 * automated callers without `--yes` fail safe rather than hanging.
 */
async function confirmOrAbort(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error(
      chalk.red(
        'Refusing to force-push on non-TTY stdin without --yes. Re-run with --yes to confirm.'
      )
    );
    return false;
  }
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
      'Working tree has uncommitted or unstaged tracked changes. Commit or stash them before running release:finalize.'
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
 * Decide whether to proceed with the force-push. Returns true if the
 * user confirmed interactively or passed `--yes`, false otherwise.
 */
async function shouldProceedWithForcePush(yes: boolean): Promise<boolean> {
  if (yes) return true;
  return confirmOrAbort('This will rebase develop onto main and force-push. Proceed?');
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

  console.log(chalk.cyan(dryRun ? '[dry-run] Finalizing release' : 'Finalizing release'));

  // Step 1: fetch. Dry-run prints; real run actually fetches (we need
  // the current remote state for the ahead-count check that follows).
  console.log(chalk.dim('Fetching remote refs...'));
  planStep(['fetch', '--all'], dryRun);

  // Step 2: detect no-op. In dry-run this also runs so users see real state.
  // In real mode we already fetched so the ref is current.
  if (!dryRun && commitsMainAheadOfDevelop() === 0) {
    console.log(chalk.green('✓ develop already contains every main commit — nothing to finalize'));
    return;
  }
  if (dryRun) {
    // In dry-run we need the count without having fetched first; check with
    // whatever refs we have locally so the preview is still informative.
    const ahead = commitsMainAheadOfDevelop();
    if (ahead === 0) {
      console.log(
        chalk.green('✓ develop already contains every main commit — nothing to finalize')
      );
      return;
    }
    console.log(
      chalk.yellow(
        `(preview, local refs — may be stale) main ahead of develop by ${ahead} commit(s)`
      )
    );
  } else {
    console.log(chalk.yellow(`main ahead of develop — rebase needed`));
  }

  // Step 3: confirm the force-push branch. Rebase itself is safe (local
  // only, reversible via --abort); the force-push needs explicit sign-off.
  if (!dryRun && !(await shouldProceedWithForcePush(yes))) {
    console.log(chalk.dim('Aborted by user.'));
    return;
  }

  // Step 4: sync main locally. Nice-to-have: keeps local main pointer
  // matching origin/main; not strictly required since rebase uses the
  // remote-tracking ref. Explicit `origin main` avoids depending on
  // upstream tracking being configured (it usually is, but a fresh
  // clone or a manually-reset branch can be missing the link).
  console.log(chalk.dim('Syncing main...'));
  planStep(['checkout', 'main'], dryRun);
  planStep(['pull', '--ff-only', 'origin', 'main'], dryRun);

  // Step 5: switch back to develop, pull, rebase. The ff-only pull fails
  // loudly if the local tip has diverged from origin/develop — better
  // than a surprise mid-rebase.
  console.log(chalk.dim('Syncing develop and rebasing onto main...'));
  planStep(['checkout', 'develop'], dryRun);
  planStep(['pull', '--ff-only', 'origin', 'develop'], dryRun);
  if (dryRun) {
    console.log(chalk.dim('  [dry-run] git rebase origin/main'));
  } else {
    rebaseOrAbortCleanly();
  }

  // Step 6: force-push. --force-with-lease (never raw --force) so a
  // concurrent push from someone else refuses instead of clobbering it.
  // Explicit `origin develop` refspec guards against the unlikely case
  // where `checkout develop` landed on an unexpected branch — the push
  // refuses rather than silently pushing the wrong tracking branch.
  console.log(chalk.dim('Force-pushing develop...'));
  planStep(['push', '--force-with-lease', 'origin', 'develop'], dryRun);

  console.log(
    chalk.green(
      dryRun
        ? '✓ Dry run complete — re-run without --dry-run to apply'
        : '✓ Finalize complete — develop is now SHA-aligned with main'
    )
  );
}
