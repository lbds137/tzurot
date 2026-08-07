/**
 * The CI gate that PR monitoring waits on.
 *
 * Replaces the hand-pasted bash one-liner that used to live (in triplicate) in
 * the rule, the skill, and the hook. Owning it here buys three things the
 * one-liner structurally could not:
 *
 * 1. **Argument validation.** An abbreviated SHA matches nothing in
 *    `actions/runs?head_sha=`, which the old gate read as "keep waiting" — so a
 *    typo spun silently to the 30-minute timeout. Here it is rejected before the
 *    first poll.
 * 2. **Loud failure.** A `gh api` failure (auth, rate limit, network) produced no
 *    output at all in the old loop: jq got nothing, grep matched nothing, sleep
 *    ran again. A broken gate looked exactly like a slow one for half an hour.
 * 3. **A release condition that isn't one workflow's name.** See
 *    `isReleasable` — the old gate assumed the `CI` workflow always outlasts
 *    every other check, which rested on a single measurement.
 *
 * Waiting on the RUN rather than a fixed `sleep` is still the core idea:
 * `gh pr checks --watch` snapshots the check list at start time, so handing off
 * early means watching only the checks that registered fast. Run creation itself
 * can lag a push by minutes, so no constant bounds it.
 */

import { execFileSync } from 'node:child_process';
import { UsageError } from '../utils/errors.js';
import { REPO } from './github-api.js';

/** Full 40-char hex. The API silently returns nothing for an abbreviated SHA. */
const FULL_SHA = /^[0-9a-f]{40}$/i;

/** The workflow whose completion means every other check has long since registered. */
const ANCHOR_WORKFLOW = 'CI';

export const GATE_DEFAULTS = {
  /** Between polls. Matches the old loop; well under any API rate limit. */
  POLL_INTERVAL_MS: 30_000,
  /** Liveness line while waiting, so a slow gate reads differently from a dead one. */
  HEARTBEAT_MS: 600_000,
  /** Below the Monitor's 30-min timeout, so we exit with a reason instead of being killed. */
  MAX_WAIT_MS: 1_500_000,
  /** Consecutive `gh api` failures between repeat reports (the first is always reported). */
  ERROR_REPEAT_EVERY: 10,
  /** Pause after `--watch` exits, before the final report reads the same lagging index. */
  SETTLE_MS: 5_000,
  /**
   * Re-read delay before declaring a PR-head mismatch.
   *
   * MEASURED, not guessed: after a push to an open PR, `pulls/N.head.sha`
   * still returned the previous SHA at 680ms and matched at 1379ms. That is a
   * different and far smaller lag than the `actions/runs?head_sha=` search
   * index (minutes) — a PR object, not a search — but it is not zero, so a
   * first-read refusal could reject a monitor armed immediately after a push.
   * Real drift persists, so the re-read costs it nothing.
   */
  HEAD_RECHECK_MS: 3_000,
} as const;

export interface WorkflowRun {
  /** Needed to build the `gh run rerun <id>` the startup-failure message prints. */
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
}

export interface GateState {
  totalRuns: number;
  /** Names of runs that have not reached `completed`. */
  pending: string[];
  /** The anchor workflow finished, and not by dying before dispatch. */
  anchorComplete: boolean;
  /** Runs that died before dispatch — terminal instantly, with zero jobs. */
  startupFailures: { name: string; id: number }[];
}

export function parseGateState(runs: WorkflowRun[]): GateState {
  return {
    totalRuns: runs.length,
    pending: runs.filter(r => r.status !== 'completed').map(r => `${r.name}(${r.status})`),
    anchorComplete: runs.some(
      r =>
        r.name === ANCHOR_WORKFLOW && r.status === 'completed' && r.conclusion !== 'startup_failure'
    ),
    startupFailures: runs
      .filter(r => r.conclusion === 'startup_failure')
      .map(r => ({ name: r.name, id: r.id })),
  };
}

/**
 * Both conditions are required, and each covers the other's blind spot.
 *
 * `anchorComplete` alone was the old gate: it can't release early (a run that
 * doesn't exist yet reports nothing), but it assumes `CI` finishes last — an
 * assumption resting on one measurement from one docs-only push. A slower check
 * that hasn't registered when CI completes would hand off to `--watch` against a
 * partial list, which is the premature-`CI_COMPLETE` bug the gate exists to kill.
 *
 * "Nothing pending" alone fixes that but releases immediately in the window
 * before the anchor run has been created — every run that exists so far is a
 * fast one, and they're all terminal.
 *
 * Together: the anchor pins the floor, the pending check catches anything slower.
 */
export function isReleasable(state: GateState): boolean {
  return state.totalRuns > 0 && state.anchorComplete && state.pending.length === 0;
}

export interface GateArgs {
  prNumber: number;
  sha: string;
}

/**
 * Whether the SHA names a commit in this repo.
 *
 * The format check alone is not enough, and the gap is not hypothetical: a SHA
 * transcribed by hand from an abbreviated `git commit` line — the remaining
 * characters filled in from nowhere — is still 40 hex characters. It passes
 * `FULL_SHA`, matches nothing in the runs API, and the gate then waits out its
 * ENTIRE timeout on a commit that does not exist. Resolving it locally costs one
 * `git cat-file` and turns that into an instant error.
 */
export function gitHasCommit(sha: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * The PR number arrives already parsed by `parsePrNumber` (the shared `gh:*`
 * validator, which enforces `min: 1`), so only the SHA needs checking here.
 */
export function validateGateArgs(
  prNumber: number,
  shaInput: string | undefined,
  commitExists: (sha: string) => boolean = gitHasCommit
): GateArgs {
  // Normalize case rather than rejecting it: `git cat-file` is case-sensitive
  // while the runs API's head_sha match is not, so an uppercase SHA would
  // resolve in one lookup and not the other.
  const sha = shaInput?.toLowerCase();
  // The messages below name the command substitution rather than describing the
  // value: every bad SHA so far came from transcribing one by hand.
  if (sha === undefined || sha === '') {
    throw new UsageError('--sha is required — pass `$(git rev-parse HEAD)` right after pushing');
  }
  if (!FULL_SHA.test(sha)) {
    throw new UsageError(
      `--sha must be the full 40-character SHA, got "${sha}" (${sha.length} chars). ` +
        'The runs API matches nothing on an abbreviated SHA, so the gate would wait forever. ' +
        'Use `git rev-parse HEAD`.'
    );
  }
  if (!commitExists(sha)) {
    throw new UsageError(
      `--sha ${sha} is well-formed but does not name a commit in this repo. ` +
        'The runs API will never match it, so the gate would wait out its full timeout. ' +
        'Use `$(git rev-parse HEAD)` rather than completing an abbreviated SHA by hand.'
    );
  }
  return { prNumber, sha };
}

/** Bound on the head lookup; a hang must degrade to fail-open, not to silence. */
export const HEAD_FETCH_TIMEOUT_MS = 15_000;

/** Reads the PR's head SHA, or `undefined` when it cannot be read at all. */
export function fetchPrHeadSha(prNumber: number): string | undefined {
  let raw: string;
  try {
    raw = execFileSync('gh', ['api', `repos/${REPO}/pulls/${prNumber}`, '--jq', '.head.sha'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      // A hang here would block the whole process synchronously. Bounded so it
      // degrades into the fail-open path (which says so) instead of silence.
      timeout: HEAD_FETCH_TIMEOUT_MS,
    });
  } catch {
    return undefined;
  }
  const sha = raw.trim().toLowerCase();
  return FULL_SHA.test(sha) ? sha : undefined;
}

export type HeadShaVerdict =
  { kind: 'match' } | { kind: 'unknown' } | { kind: 'mismatch'; prHead: string };

/**
 * Whether `--sha` is the SHA this PR actually points at.
 *
 * Closes the one window the substitution opened. `$(git rev-parse HEAD)`
 * resolves when the Monitor runs, not when you pushed, so anything moving `HEAD`
 * in between — a branch checkout to file a tracker task is the realistic one —
 * makes the gate watch a different commit. Neither `FULL_SHA` nor `gitHasCommit`
 * catches it: a moved `HEAD` still names a real local commit, so it validates
 * cleanly and the gate then waits on the wrong SHA in silence.
 *
 * `undefined` means "could not tell" and is treated as fine. This check is a
 * safety net, not a gate on the gate: a `gh` hiccup must never stop a monitor
 * from arming, because the failure it prevents is rarer than the failure of
 * refusing to watch CI at all.
 */
export function classifyHeadSha(sha: string, prHead: string | undefined): HeadShaVerdict {
  if (prHead === undefined) return { kind: 'unknown' };
  return prHead === sha ? { kind: 'match' } : { kind: 'mismatch', prHead };
}

/**
 * Classify, and on a mismatch re-read once before believing it.
 *
 * The first read can legitimately trail a just-landed push (see
 * `HEAD_RECHECK_MS` for the measurement). Genuine drift — a `HEAD` that moved
 * to another branch — does not resolve itself, so the second read still
 * disagrees and the refusal stands.
 */
export async function confirmHeadSha(
  sha: string,
  prNumber: number,
  fetch: (prNumber: number) => string | undefined,
  wait: (ms: number) => Promise<void>
): Promise<HeadShaVerdict> {
  // Catch here rather than trusting the injected fetcher. `fetchPrHeadSha`
  // already returns undefined on failure, but the fail-open promise belongs to
  // THIS function — an override that throws would otherwise surface as a stack
  // trace and stop the monitor arming, which is the opposite of the guarantee.
  const read = (): string | undefined => {
    try {
      return fetch(prNumber);
    } catch {
      return undefined;
    }
  };
  const first = classifyHeadSha(sha, read());
  if (first.kind !== 'mismatch') return first;
  await wait(GATE_DEFAULTS.HEAD_RECHECK_MS);
  return classifyHeadSha(sha, read());
}

export function describeHeadMismatch(prNumber: number, sha: string, prHead: string): string {
  // Deliberately does NOT assert the cause. The likeliest is that HEAD moved
  // between push and arm, but a mismatch surviving the re-check could also be
  // replication lag beyond HEAD_RECHECK_MS, whose bound comes from one
  // measurement rather than a distribution. Naming a cause we cannot observe
  // would send the reader after the wrong fix (`00-critical.md` § Don't Present
  // Speculation as Fact), so the message states what IS known and offers the
  // common cause as a candidate.
  return (
    `--sha ${sha} is not the head of PR #${prNumber}, which points at ${prHead}. ` +
    'The gate re-read once and still disagrees. Most often HEAD moved between the ' +
    'push and the arm (a branch checkout does it); an unusually slow GitHub ' +
    'replication is the other candidate. Nothing else would have caught either: ' +
    "the SHA is real, so the gate would have waited on another commit's CI and " +
    "reported this PR's checks beside it. Confirm with `git rev-parse HEAD` and " +
    '`gh pr view ' +
    `${prNumber} --json headRefOid\`, then re-arm.`
  );
}

/** Thrown when `gh api` fails, so the loop can report it instead of swallowing it. */
export class GhApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GhApiError';
  }
}

/**
 * The API page size, and the point at which the result may be truncated.
 *
 * One PR SHA accrues 2–3 runs here, so 100 is ~30× headroom — but truncation
 * would be invisible AND unsafe: a pending or `startup_failure` run on page 2
 * would never be seen, and the gate could release early on a partial list.
 * `fetchRuns` warns at the ceiling rather than paginating, because a full page
 * means something unusual is happening (manual dispatch, a rerun storm) that a
 * human should look at, not something to silently absorb.
 */
export const RUNS_PAGE_SIZE = 100;

export function fetchRuns(
  sha: string,
  warn: (message: string) => void = console.warn
): WorkflowRun[] {
  let raw: string;
  try {
    raw = execFileSync(
      'gh',
      [
        'api',
        `repos/${REPO}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=${RUNS_PAGE_SIZE}`,
        '--jq',
        '.workflow_runs',
      ],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    const detail = (stderr || (error as Error).message).trim().split('\n')[0];
    throw new GhApiError(detail);
  }
  let runs: WorkflowRun[];
  try {
    runs = JSON.parse(raw) as WorkflowRun[];
  } catch {
    throw new GhApiError(`unparseable response: ${raw.trim().slice(0, 120)}`);
  }
  if (runs.length >= RUNS_PAGE_SIZE) {
    warn(
      `⚠️  ${runs.length} workflow runs on this SHA — at the ${RUNS_PAGE_SIZE}-run page ceiling. ` +
        'Runs beyond page 1 are invisible to the gate, so it may release on a partial list.'
    );
  }
  return runs;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export interface WaitDeps {
  fetch: (sha: string) => WorkflowRun[];
  now: () => number;
  wait: (ms: number) => Promise<void>;
  log: (message: string) => void;
}

export type WaitOutcome = 'releasable' | 'startup-failure' | 'timeout';

/**
 * One sentinel per outcome, so absence of `CI_COMPLETE` is not the only signal.
 *
 * Under the bash gate this replaces, absence WAS the signal — that loop had no
 * timeout of its own, so the only way not to see `CI_COMPLETE` was Monitor hard-
 * killing the process at 30 minutes. This gate gives up at 25, which means it
 * always reaches the print. Emitting `CI_COMPLETE` for a give-up would let a
 * reader scanning for the sentinel read "gave up without CI ever finishing" as a
 * normal completion — the exact ambiguity this command exists to remove.
 */
export const SENTINELS: Record<WaitOutcome, string> = {
  releasable: 'CI_COMPLETE',
  timeout: 'CI_GATE_TIMEOUT',
  'startup-failure': 'CI_GATE_STARTUP_FAILURE',
};

/**
 * Whether a failure at this consecutive-count should be reported. The first
 * always is — a broken gate must be visible immediately — and then every Nth,
 * so a sustained auth failure doesn't emit a line every 30 seconds.
 */
export function shouldReportError(consecutiveErrors: number): boolean {
  return consecutiveErrors === 1 || consecutiveErrors % GATE_DEFAULTS.ERROR_REPEAT_EVERY === 0;
}

/** What the heartbeat says about the current poll, including "we have no data". */
export function describeWaitState(state: GateState | undefined): string {
  if (state === undefined) return 'no data (gh api failing)';
  if (state.totalRuns === 0) return 'no runs registered yet';
  const pending = state.pending.length > 0 ? state.pending.join(', ') : 'none';
  return `pending: ${pending}; anchor ${state.anchorComplete ? 'done' : 'not done'}`;
}

/** One poll: the fetched state, or undefined when `gh api` failed (already reported). */
function pollOnce(
  sha: string,
  deps: WaitDeps,
  errors: { consecutive: number }
): GateState | undefined {
  try {
    const state = parseGateState(deps.fetch(sha));
    if (errors.consecutive > 0) {
      deps.log(`✓ gh api recovered after ${errors.consecutive} failure(s)`);
      errors.consecutive = 0;
    }
    return state;
  } catch (error) {
    errors.consecutive += 1;
    if (shouldReportError(errors.consecutive)) {
      const detail = error instanceof Error ? error.message : String(error);
      deps.log(`⚠️  gh api failed (${errors.consecutive}x): ${detail}`);
    }
    return undefined;
  }
}

/**
 * Poll until the gate releases, a run dies before dispatch, or we run out of time.
 *
 * `startup-failure` exits early on purpose: such a run is terminal the instant it
 * appears and creates zero jobs, so it is invisible in `gh pr checks` — waiting
 * out the full timeout on it tells you nothing you don't already know.
 *
 * The startup-failure check deliberately spans EVERY workflow on the SHA, not
 * just the anchor. A run dying before dispatch is an Actions-infrastructure
 * signal, and its blast radius is never known to be one workflow; surfacing it
 * immediately is more useful than waiting to see whether the anchor survives.
 * The message names which workflow died, and the final `gh pr checks` report
 * still prints, so nothing is lost if the rest of the run turns out healthy.
 */
export async function waitForCi(sha: string, deps: WaitDeps): Promise<WaitOutcome> {
  const started = deps.now();
  const errors = { consecutive: 0 };
  let lastHeartbeat = started;

  for (;;) {
    const state = pollOnce(sha, deps, errors);

    if (state !== undefined && state.startupFailures.length > 0) {
      // The rerun command is spelled out because the doc's outcome table
      // prescribes exactly this fix; making the reader go find the run id in a
      // separate SHA-pinned query would leave the message loud but not actionable.
      const failed = state.startupFailures.map(f => `${f.name} (run ${f.id})`).join(', ');
      const rerun = state.startupFailures.map(f => `gh run rerun ${f.id}`).join(' && ');
      deps.log(
        `❌ workflow run died before dispatch (startup_failure): ${failed}. ` +
          'It created zero jobs, so it is absent from `gh pr checks` entirely. ' +
          `Rerun with: ${rerun}`
      );
      return 'startup-failure';
    }
    if (state !== undefined && isReleasable(state)) return 'releasable';

    const elapsed = deps.now() - started;
    if (elapsed >= GATE_DEFAULTS.MAX_WAIT_MS) {
      deps.log(
        `⏱️  gate gave up after ${Math.round(elapsed / 60_000)}m — CI never reached a releasable state. Re-arm.`
      );
      return 'timeout';
    }
    if (deps.now() - lastHeartbeat >= GATE_DEFAULTS.HEARTBEAT_MS) {
      lastHeartbeat = deps.now();
      deps.log(`⏳ ${Math.round(elapsed / 60_000)}m — ${describeWaitState(state)}`);
    }

    await deps.wait(GATE_DEFAULTS.POLL_INTERVAL_MS);
  }
}

export function runChecks(prNumber: number, watch: boolean, log = console.log): void {
  const args = ['pr', 'checks', String(prNumber)];
  if (watch) args.push('--watch', '--interval=30');
  try {
    execFileSync('gh', args, {
      encoding: 'utf-8',
      // The watch pass is only a wait; the final pass is the report the agent reads.
      stdio: watch ? ['pipe', 'ignore', 'ignore'] : ['pipe', 'inherit', 'inherit'],
    });
  } catch (error) {
    // A NONZERO EXIT is expected and must be ignored: `gh pr checks` exits
    // non-zero whenever ANY check is red, including the intentional
    // `fixup-check` red on a fixup-bearing branch. That is a report, not a
    // failure of this command.
    //
    // A SPAWN failure is the opposite — `gh` missing from PATH or unauthorized
    // produces no report at all, so swallowing it would print nothing after
    // CI_COMPLETE and read as "no checks", which is the silent-failure mode
    // this command exists to eliminate.
    // `status` is the child's exit code, present only when a child actually ran.
    // A spawn failure leaves it absent (ENOENT carries `code`/`errno` instead).
    const { status, signal } = error as { status?: number | null; signal?: string | null };
    if (status === undefined || status === null) {
      const detail = error instanceof Error ? error.message : String(error);
      // A signal-killed child also reports a null status, so name the signal —
      // "killed by SIGKILL" and "gh is not on PATH" want different responses.
      const cause = signal !== undefined && signal !== null ? `killed by ${signal}` : detail;
      log(`⚠️  \`gh pr checks\` could not run: ${cause}`);
    }
  }
}

export interface GateRunDeps {
  wait: WaitDeps;
  checks: (prNumber: number, watch: boolean) => void;
  /** Pause between the watch handoff and the final report. See SETTLE_MS. */
  settle: (ms: number) => Promise<void>;
  log: (message: string) => void;
  commitExists: (sha: string) => boolean;
  prHead: (prNumber: number) => string | undefined;
}

export async function runCiGate(
  prNumber: number,
  options: { sha?: string },
  overrides: Partial<GateRunDeps> = {}
): Promise<void> {
  const log = overrides.log ?? ((message: string) => console.log(message));
  const checks = overrides.checks ?? ((pr: number, watch: boolean) => runChecks(pr, watch, log));
  const settle = overrides.settle ?? sleep;
  const args = validateGateArgs(prNumber, options.sha, overrides.commitExists);

  // This line comes BEFORE the head check on purpose. The check is a synchronous
  // network call, and a hang in it would otherwise produce zero output until the
  // Monitor's external kill — the exact "a broken gate looks like a slow one"
  // shape this command exists to remove.
  log(`⏱️  Waiting for CI on PR #${args.prNumber} @ ${args.sha.slice(0, 8)}…`);

  const headVerdict = await confirmHeadSha(
    args.sha,
    args.prNumber,
    overrides.prHead ?? fetchPrHeadSha,
    settle
  );
  if (headVerdict.kind === 'mismatch') {
    throw new UsageError(describeHeadMismatch(args.prNumber, args.sha, headVerdict.prHead));
  }
  if (headVerdict.kind === 'unknown') {
    // Say so rather than failing open in silence: "checked and matched" and
    // "could not check" are different states, and only one of them means the
    // drift protection was actually active for this arm.
    log('⚠️  Could not read the PR head; arming without the drift check.');
  }

  const outcome = await waitForCi(
    args.sha,
    // `sha => fetchRuns(sha, log)`, not the bare reference: fetchRuns' page-
    // ceiling warning would otherwise fall back to its own console.warn default
    // and go to stderr, while every other diagnostic here goes through `log` to
    // stdout. That warning reports the one condition the gate structurally
    // cannot see past, so it must not be the one least likely to surface.
    overrides.wait ?? {
      fetch: (sha: string) => fetchRuns(sha, log),
      now: () => Date.now(),
      wait: sleep,
      log,
    }
  );

  // Every outcome reports the current check state — even a timeout or a
  // startup_failure, where what the checks DO say is the useful next datum.
  if (outcome === 'releasable') {
    checks(args.prNumber, true);
    // Carried from the bash gate this replaces, deliberately rather than by
    // inertia: `--watch` exits on ITS last poll, and the check-run list is the
    // same eventually-consistent surface whose indexing lag is documented in
    // 05-tooling.md. Re-querying in the same instant can read a list that has
    // not caught up. Five seconds is cheap against a ~20-minute wait.
    await settle(GATE_DEFAULTS.SETTLE_MS);
  }

  log(SENTINELS[outcome]);
  checks(args.prNumber, false);

  if (outcome !== 'releasable') process.exitCode = 1;
}
