/**
 * Workflow-Sync Guard
 *
 * GitHub Actions that validate against the default branch (claude-review,
 * the @claude responder) refuse to run unless their workflow file is
 * byte-identical to the version on `main`. A workflow change that lands on
 * `develop` first therefore silently disables those reviews on EVERY PR —
 * each shows a green ~15s no-op ("Skipping action due to workflow
 * validation") — until the change reaches `main` at the next release.
 *
 * This guard fails when `.github/workflows/` on HEAD differs from
 * `origin/main`, directing the author to the sanctioned main-cut PR path
 * (tzurot-git-workflow skill § "Workflow-file changes target main").
 *
 * It intentionally SKIPS (passes) on main-cut branches — the sanctioned
 * path must not be blocked by its own guard. Detection: --base flag >
 * GITHUB_BASE_REF (PR builds; this repo's CI is push-only, so it's an
 * override for other contexts) > branch TOPOLOGY. The topology test works
 * because the rebase-only flow keeps main an ancestor of develop: a
 * main-cut branch carries no develop-exclusive history, so its merge-base
 * with origin/develop is an ancestor of origin/main. (When develop == main
 * exactly, every branch looks main-cut and the guard skips — a narrow
 * false-pass window; the push-to-develop CI run re-checks after merge.)
 */

import { execFileSync } from 'node:child_process';
import chalk from 'chalk';

const WORKFLOWS_PATH = '.github/workflows/';

/** @internal Exported for testing */
export interface WorkflowSyncOptions {
  /** Override the merge-target used for the skip decision. */
  base?: string;
  /** Env source, injectable for tests (defaults to process.env). */
  env?: Record<string, string | undefined>;
  /** Command runner, injectable for tests. */
  runGit?: (args: string[]) => string;
}

function defaultRunGit(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' });
}

/**
 * Make sure `origin/<branch>` exists locally — fetch it when absent (shallow
 * CI checkouts have only the pushed branch). NOTE: an existing-but-STALE ref
 * is used as-is (CI always checks out fresh; locally a stale ref can produce
 * a stale verdict — `git fetch origin <branch>` refreshes it).
 */
function ensureRef(runGit: (args: string[]) => string, branch: string): void {
  try {
    runGit(['rev-parse', '--verify', `origin/${branch}`]);
  } catch {
    runGit(['fetch', 'origin', branch, '--depth=1']);
  }
}

/**
 * Resolve an EXPLICIT merge-target when one is declared (--base flag or a
 * PR build's GITHUB_BASE_REF). Returns null when neither is present — the
 * caller then falls back to branch topology.
 * @internal Exported for testing
 */
export function resolveExplicitBase(options: WorkflowSyncOptions): string | null {
  if (options.base !== undefined && options.base.length > 0) {
    return options.base;
  }
  const env = options.env ?? process.env;
  const prBase = env.GITHUB_BASE_REF;
  if (prBase !== undefined && prBase.length > 0) {
    return prBase;
  }
  return null;
}

/**
 * Topology test: is HEAD a main-cut branch? True when the branch carries no
 * develop-exclusive history — its merge-base with origin/develop is an
 * ancestor of origin/main. Requires the rebase-only invariant (main is
 * always an ancestor of develop).
 * @internal Exported for testing
 */
export function isMainCutBranch(runGit: (args: string[]) => string): boolean {
  ensureRef(runGit, 'develop');
  ensureRef(runGit, 'main');
  const mergeBase = runGit(['merge-base', 'HEAD', 'origin/develop']).trim();
  try {
    runGit(['merge-base', '--is-ancestor', mergeBase, 'origin/main']);
    return true;
  } catch {
    return false;
  }
}

/**
 * List workflow files whose HEAD content differs from origin/main.
 * @internal Exported for testing
 */
export function diffWorkflowsAgainstMain(runGit: (args: string[]) => string): string[] {
  ensureRef(runGit, 'main');
  const out = runGit(['diff', '--name-only', 'origin/main', 'HEAD', '--', WORKFLOWS_PATH]);
  return out
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

export function checkWorkflowSync(options: WorkflowSyncOptions = {}): void {
  const explicitBase = resolveExplicitBase(options);
  if (explicitBase === 'main') {
    console.log(
      chalk.yellow(
        'workflow-sync: target is main — skipping (main-cut workflow PRs are the sanctioned path)'
      )
    );
    return;
  }

  const runGit = options.runGit ?? defaultRunGit;
  let drifted: string[];
  try {
    if (explicitBase === null && isMainCutBranch(runGit)) {
      console.log(
        chalk.yellow('workflow-sync: main-cut branch (no develop-exclusive history) — skipping')
      );
      return;
    }
    drifted = diffWorkflowsAgainstMain(runGit);
  } catch (error) {
    // Can't compare (no network for the fetch, no origin remote). Fail OPEN
    // with a loud warning: the guard exists to catch silent drift, but a git
    // hiccup must not block unrelated local work.
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.yellow(`workflow-sync: could not compare against origin/main (${message})`));
    console.log(chalk.yellow('workflow-sync: skipping — re-run when origin/main is reachable'));
    return;
  }

  if (drifted.length === 0) {
    console.log(chalk.green('✓ Workflow files are in sync with origin/main'));
    return;
  }

  console.log(chalk.red.bold('✗ Workflow files differ from origin/main:'));
  for (const file of drifted) {
    console.log(chalk.red(`   ${file}`));
  }
  console.log('');
  console.log('Workflow changes landing on develop SILENTLY DISABLE claude-review on');
  console.log('every PR (green ~15s no-op) until they reach main at the next release.');
  console.log('');
  console.log('Route this change through a MAIN-cut PR instead:');
  console.log('  1. Branch from main, apply ONLY the workflow change, PR against main');
  console.log('  2. After it merges: pnpm ops release:finalize  (resyncs develop)');
  console.log('See the tzurot-git-workflow skill § "Workflow-file changes target main".');
  console.log('');
  console.log('(Already on a main-cut branch the topology test missed? Re-run with');
  console.log(' `pnpm ops guard:workflow-sync --base main` to skip explicitly.)');
  process.exitCode = 1;
}
