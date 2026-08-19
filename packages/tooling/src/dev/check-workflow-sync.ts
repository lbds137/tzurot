/**
 * Workflow-Sync Guard
 *
 * GitHub Actions that validate against the default branch (claude-review,
 * the @claude responder) refuse to run unless their OWN workflow file is
 * byte-identical to the version on `main`. A change to one of those files
 * that lands on `develop` first therefore silently disables the reviews on
 * EVERY PR — each shows a green ~15s no-op ("Skipping action due to
 * workflow validation") — until the change reaches `main` at the next
 * release.
 *
 * The validation is scoped to the action's own file: a drift in any OTHER
 * workflow (e.g. ci.yml) still gets a real review, and those workflows
 * execute from the PR branch anyway — so they may land via develop like
 * any code change. This guard therefore checks ONLY the self-validating
 * workflow files below, directing the author to the sanctioned main-cut PR
 * path (tzurot-git-workflow skill § "Claude workflow changes target main").
 *
 * It intentionally SKIPS (passes) on main-cut branches — the sanctioned
 * path must not be blocked by its own guard. The merge target is read from
 * the only places that actually KNOW it: --base flag > GITHUB_BASE_REF (PR
 * builds) > `gh pr view` (this repo's CI is push-only, so no PR env exists
 * and GitHub must be asked directly).
 *
 * There used to be a fourth, inferential source — a branch TOPOLOGY test,
 * on the reasoning that a main-cut branch carries no develop-exclusive
 * history. It was removed rather than refined, because the information is
 * not in the graph: `release:finalize` SHA-aligns develop onto main, so
 * main's HEAD sits ON develop's history, and a branch cut from develop HEAD
 * at any point since the last release has its merge-base at exactly that
 * commit — the same shape a genuine main-cut branch has. Measured on a
 * develop-cut dependabot branch carrying real drift in both guarded files,
 * whose merge-base with develop WAS origin/main's HEAD. That is the common
 * case rather than a narrow window: any long-lived, rarely-rebased branch
 * sits in it by default. The guard skipped, printed success, and offered a
 * green that was not evidence of safety.
 *
 * ORDER MATTERS, and it is drift-first on purpose: the base is resolved
 * only once a guarded file has ALREADY been found to differ. The clean path
 * therefore makes no network call at all, which is what makes asking GitHub
 * affordable inside `pnpm quality`.
 */

import { execFileSync } from 'node:child_process';
import chalk from 'chalk';

/**
 * The workflows that self-validate against main. Add an entry when a new
 * workflow gains a main-validating action (anything wired to the Claude
 * review/responder apps) — the guard has no way to detect that on its own.
 */
const GUARDED_WORKFLOWS = [
  '.github/workflows/claude-code-review.yml',
  '.github/workflows/claude.yml',
] as const;

/** @internal Exported for testing */
export interface WorkflowSyncOptions {
  /** Override the merge-target used for the skip decision. */
  base?: string;
  /** Env source, injectable for tests (defaults to process.env). */
  env?: Record<string, string | undefined>;
  /** Command runner, injectable for tests. */
  runGit?: (args: string[]) => string;
  /** GitHub CLI runner, injectable for tests. */
  runGh?: (args: string[]) => string;
}

/**
 * Bound on the LOCAL git calls this guard makes (`rev-parse`, `merge-base`,
 * `diff`). Runs inside `pnpm quality` and CI, and the failure path already
 * fails open with a warning — bounded, a stall lands in that same path
 * instead of hanging the gate.
 */
export const WORKFLOW_SYNC_TIMEOUT_MS = 15_000;

/**
 * Separate, larger bound for `ensureRef`'s `git fetch` — one of the module's
 * two network calls, the other being `defaultRunGh`'s `gh pr view`, which
 * carries its own bound for the opposite reason (see {@link
 * WORKFLOW_GH_TIMEOUT_MS}). A local-probe value is the wrong scale for a round trip to
 * GitHub, and the cost of getting it wrong is asymmetric here: this guard
 * fails OPEN, so a spurious timeout skips the check silently, and the thing
 * it checks is whether a workflow-file drift has silently disabled
 * claude-review on every PR. A slow network must not look like "no drift".
 */
export const WORKFLOW_FETCH_TIMEOUT_MS = 60_000;

function defaultRunGit(args: string[]): string {
  // `fetch` is the only network op among the GIT calls; every other git
  // invocation here is local. (The module's other network call goes out
  // through `defaultRunGh`, which has its own runner and its own bound.)
  const timeout = args[0] === 'fetch' ? WORKFLOW_FETCH_TIMEOUT_MS : WORKFLOW_SYNC_TIMEOUT_MS;
  return execFileSync('git', args, { encoding: 'utf-8', timeout });
}

/**
 * Bound on the `gh pr view` round trip. Shares the network scale of
 * {@link WORKFLOW_FETCH_TIMEOUT_MS} rather than the local-probe one, for the
 * same reason: a slow network must not be mistaken for an answer. Unlike the
 * fetch, a timeout here fails CLOSED (see {@link resolvePrBase}), so the cost
 * of it being too small is a false ALARM, not a false pass.
 */
export const WORKFLOW_GH_TIMEOUT_MS = 30_000;

function defaultRunGh(args: string[]): string {
  // stderr is PIPED rather than inherited, and rather than discarded. Inherited,
  // gh's own "no pull requests found" prints raw above the guard's verdict and
  // reads as a crash; discarded, the reason a base lookup failed (no PR / no
  // token / no gh) is unrecoverable. Piped, execFileSync attaches it to the
  // thrown error, and the caller reports it as part of its own message.
  return execFileSync('gh', args, {
    encoding: 'utf-8',
    timeout: WORKFLOW_GH_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Ask GitHub for the open PR's base branch, or null when it cannot be known.
 *
 * Null covers every unknowable case identically — no PR open yet, no `gh` on
 * PATH, no token in CI, a network failure — because the CALLER's response to
 * all of them is the same: treat the drift as real. The alternative (guessing)
 * is what this function replaced.
 *
 * `currentBranch` is a REFUSAL condition, not context. On `develop` a release
 * PR (develop → main) is routinely open, and asking `gh pr view` there returns
 * base=main — which would skip the guard on develop for the entire duration of
 * every release, silently retiring the post-merge backstop exactly when a
 * workflow drift is most likely to be in flight. Long-lived branches are never
 * main-cut feature branches, so the question is not asked of them.
 *
 * @internal Exported for testing
 */
export function resolvePrBase(
  runGh: (args: string[]) => string,
  currentBranch: string
): { base: string | null; reason?: string } {
  if (currentBranch === 'develop' || currentBranch === 'main') {
    return { base: null, reason: `on ${currentBranch}, where a release PR would answer "main"` };
  }
  // An UNKNOWN branch refuses for the same reason a long-lived one does, and
  // this is what makes the `HEAD`-to-`''` translation above load-bearing rather
  // than cosmetic: without it, a detached checkout would present as a branch
  // named "HEAD", pass this guard, and let `gh` answer from whatever context it
  // can reconstruct — which during a release window is the develop→main PR,
  // reproducing exactly the false skip this module was rewritten to end.
  if (currentBranch.length === 0) {
    return { base: null, reason: 'current branch could not be determined' };
  }
  try {
    // STATE is requested alongside the base, and anything but OPEN is refused.
    // `gh pr view --help` documents only that it shows "the pull request that
    // belongs to the current branch" — it names no tie-break for a branch with
    // several associated PRs, so a closed PR→main sitting beside an open
    // PR→develop could otherwise hand back "main" and skip the guard, which is
    // a variant of the very bug this module was rewritten to end. Refusing on
    // state makes that unreachable WITHOUT needing to know how gh chooses:
    // whichever PR it picks, only an open one is trusted.
    // Probed: the field is exactly one of OPEN / CLOSED / MERGED.
    const out = runGh([
      'pr',
      'view',
      '--json',
      'baseRefName,state',
      '--jq',
      '.state + " " + .baseRefName',
    ]).trim();
    if (out.length === 0) {
      return { base: null, reason: 'gh returned no base branch' };
    }
    const [state, ...rest] = out.split(' ');
    const base = rest.join(' ');
    if (state !== 'OPEN') {
      return { base: null, reason: `the branch's PR is ${state}, not OPEN` };
    }
    return base.length > 0 ? { base } : { base: null, reason: 'gh returned no base branch' };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr;
    const detail =
      stderr !== undefined && stderr.trim().length > 0
        ? stderr.trim()
        : error instanceof Error
          ? error.message
          : String(error);
    // A thrown non-Error can stringify to nothing, which would render as
    // `could not read the PR base ()` — an empty parenthetical reads as a bug
    // in the guard rather than as an unexplained failure of the lookup.
    return { base: null, reason: detail.length > 0 ? detail : 'gh failed without a message' };
  }
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
 * caller then asks GitHub directly, via {@link resolvePrBase}.
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
 * List guarded (self-validating) workflow files whose HEAD content differs
 * from origin/main.
 * @internal Exported for testing
 */
export function diffWorkflowsAgainstMain(runGit: (args: string[]) => string): string[] {
  ensureRef(runGit, 'main');
  const out = runGit(['diff', '--name-only', 'origin/main', 'HEAD', '--', ...GUARDED_WORKFLOWS]);
  return out
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

/**
 * Current branch name, or `''` when it cannot be determined.
 *
 * `GITHUB_REF_NAME` first: in Actions it is the branch, exactly, with no
 * dependence on how the checkout step happened to leave the working tree.
 * (On a `pull_request` event it is `<n>/merge` instead — harmless here,
 * because such an event also sets `GITHUB_BASE_REF`, which
 * {@link resolveExplicitBase} consumes before this function is ever reached.)
 *
 * The git fallback translates the literal `HEAD` to `''`, because
 * `rev-parse --abbrev-ref HEAD` does NOT throw on a detached HEAD — it prints
 * the string `HEAD`, which would otherwise read as a branch by that name and
 * silently defeat the develop/main refusal in {@link resolvePrBase}. Same
 * translation, for the same reason, as `captureCurrentBranch` in
 * `release/finalize.ts`.
 *
 * Measured: this repo's CI checks out with a bare `actions/checkout`, which on
 * a push event runs `git checkout --force -B <branch>` and leaves a real
 * branch — so the fallback is not currently load-bearing there. It is written
 * this way so that adding an explicit `ref:` later cannot quietly turn the
 * refusal into dead code.
 */
function currentBranchName(
  runGit: (args: string[]) => string,
  env: Record<string, string | undefined>
): string {
  const fromActions = env.GITHUB_REF_NAME;
  if (fromActions !== undefined && fromActions.length > 0) {
    return fromActions;
  }
  try {
    const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    return branch === 'HEAD' ? '' : branch;
  } catch {
    return '';
  }
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

  // Only NOW is the merge target worth resolving. An explicit base that is not
  // main has already declared the answer, so GitHub is asked only when nothing
  // local declared one.
  if (drifted.length > 0 && explicitBase === null) {
    const runGh = options.runGh ?? defaultRunGh;
    const { base, reason } = resolvePrBase(
      runGh,
      currentBranchName(runGit, options.env ?? process.env)
    );
    if (base === 'main') {
      console.log(
        chalk.yellow('workflow-sync: PR targets main — skipping (sanctioned main-cut path)')
      );
      return;
    }
    if (base === null && reason !== undefined) {
      // Printed BEFORE the failure below so the verdict reads as a consequence
      // of a known-unknown rather than as a discovered drift of unclear origin.
      console.log(chalk.yellow(`workflow-sync: could not read the PR base (${reason})`));
    }
  }

  if (drifted.length === 0) {
    console.log(chalk.green('✓ Claude workflow files are in sync with origin/main'));
    return;
  }

  console.log(chalk.red.bold('✗ Claude workflow files differ from origin/main:'));
  for (const file of drifted) {
    console.log(chalk.red(`   ${file}`));
  }
  console.log('');
  console.log('Claude-workflow changes landing on develop SILENTLY DISABLE claude-review');
  console.log('on every PR (green ~15s no-op) until they reach main at the next release.');
  console.log('(Other workflow files, e.g. ci.yml, run from the PR branch and may land');
  console.log('via develop normally — this guard only covers the self-validating ones.)');
  console.log('');
  console.log('Route this change through a MAIN-cut PR instead:');
  console.log('  1. Branch from main, apply ONLY the workflow change, PR against main');
  console.log('  2. After it merges: pnpm ops release:finalize  (resyncs develop)');
  console.log('See the tzurot-git-workflow skill § "Claude workflow changes target main".');
  console.log('');
  console.log('(On a main-cut branch whose PR does not exist yet — or with no `gh`');
  console.log(' available? Re-run with `pnpm ops guard:workflow-sync --base main`.)');
  process.exitCode = 1;
}
