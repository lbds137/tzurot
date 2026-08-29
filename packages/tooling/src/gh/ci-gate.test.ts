import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  GATE_DEFAULTS,
  GhApiError,
  describeWaitState,
  gitHasCommit,
  isReleasable,
  classifyHeadSha,
  confirmHeadSha,
  describeHeadMismatch,
  parseGateState,
  reportReviewRounds,
  RUNS_PAGE_SIZE as GATE_PAGE_SIZE,
  SENTINELS,
  shouldReportError,
  validateGateArgs,
  runCiGate,
  waitForCi,
  type WaitDeps,
  type WorkflowRun,
} from './ci-gate.js';
import { UsageError } from '../utils/errors.js';

let nextRunId = 1000;
const run = (name: string, status: string, conclusion: string | null = null): WorkflowRun => ({
  id: nextRunId++,
  name,
  status,
  conclusion,
});

const DONE = (name: string) => run(name, 'completed', 'success');

/**
 * Drives waitForCi over a scripted sequence of poll results. Time advances by
 * one poll interval per call, so heartbeat/timeout behaviour is exercised
 * without any real waiting.
 */
function harness(sequence: (WorkflowRun[] | Error)[], opts: { repeatLast?: boolean } = {}) {
  const logs: string[] = [];
  let clock = 0;
  let calls = 0;
  const deps: WaitDeps = {
    fetch: () => {
      const step = sequence[Math.min(calls, sequence.length - 1)];
      calls += 1;
      if (!opts.repeatLast && calls > sequence.length) throw new Error('sequence exhausted');
      if (step instanceof Error) throw step;
      return step;
    },
    now: () => clock,
    wait: async ms => {
      clock += ms;
    },
    log: m => logs.push(m),
  };
  return { deps, logs, calls: () => calls };
}

describe('parseGateState', () => {
  it('separates pending runs, the anchor, and startup failures', () => {
    const dead = run('Deploy', 'completed', 'startup_failure');
    const state = parseGateState([DONE('CI'), run('CodeQL', 'in_progress'), dead]);
    expect(state.totalRuns).toBe(3);
    expect(state.pending).toEqual(['CodeQL(in_progress)']);
    expect(state.anchorComplete).toBe(true);
    // The id rides along so the failure message can print `gh run rerun <id>`,
    // which is the fix the docs' outcome table prescribes.
    expect(state.startupFailures).toEqual([{ name: 'Deploy', id: dead.id }]);
  });

  it('does not count a startup_failure anchor as complete', () => {
    // Such a run reaches `completed` instantly with zero jobs, so treating it
    // as the anchor would release into an almost-empty check list.
    expect(parseGateState([run('CI', 'completed', 'startup_failure')]).anchorComplete).toBe(false);
  });

  it('counts a genuinely failed anchor as complete', () => {
    expect(parseGateState([run('CI', 'completed', 'failure')]).anchorComplete).toBe(true);
  });
});

describe('isReleasable', () => {
  it('releases when the anchor is done and nothing is pending', () => {
    expect(isReleasable(parseGateState([DONE('CI'), DONE('Lint')]))).toBe(true);
  });

  it('holds when no runs exist yet (run creation lags the push)', () => {
    expect(isReleasable(parseGateState([]))).toBe(false);
  });

  it('holds when only fast non-anchor runs have finished', () => {
    // The regression the old named-CI gate prevented: everything that exists is
    // terminal, but the anchor has not been created yet.
    expect(isReleasable(parseGateState([DONE('GitGuardian')]))).toBe(false);
  });

  it('holds when a slower check is still running after the anchor finished', () => {
    // The bug the old gate had: CI was assumed to outlast everything.
    expect(isReleasable(parseGateState([DONE('CI'), run('CodeQL', 'queued')]))).toBe(false);
  });
});

describe('validateGateArgs', () => {
  const SHA = 'a'.repeat(40);
  const exists = () => true;

  it('accepts a full, resolvable SHA and numeric PR', () => {
    expect(validateGateArgs(1991, SHA, exists)).toEqual({ prNumber: 1991, sha: SHA });
  });

  it('rejects an abbreviated SHA before any polling happens', () => {
    expect(() => validateGateArgs(1991, 'a'.repeat(10), exists)).toThrow(UsageError);
    expect(() => validateGateArgs(1991, 'a'.repeat(10), exists)).toThrow(/full 40-character SHA/);
  });

  it('rejects a missing SHA', () => {
    expect(() => validateGateArgs(1991, undefined, exists)).toThrow(/--sha is required/);
  });

  it('rejects a non-hex SHA of the right length', () => {
    expect(() => validateGateArgs(1991, 'z'.repeat(40), exists)).toThrow(UsageError);
  });

  it('rejects a well-formed SHA that names no commit here', () => {
    // The failure the format check cannot see: an abbreviated SHA completed by
    // hand is still 40 hex chars, matches nothing in the runs API, and would
    // burn the gate's entire timeout.
    expect(() => validateGateArgs(1991, SHA, () => false)).toThrow(/does not name a commit/);
  });

  it('leaves PR-number validation to the shared parsePrNumber helper', () => {
    // commands/gh.ts routes the positional through parsePrNumber (min: 1) like
    // every other gh:* command, so this function receives an already-valid number.
    expect(validateGateArgs(1991, SHA, exists).prNumber).toBe(1991);
  });
});

describe('classifyHeadSha', () => {
  const SHA = 'a'.repeat(40);

  it('matches when the PR points at the same commit', () => {
    expect(classifyHeadSha(SHA, SHA)).toEqual({ kind: 'match' });
  });

  it('reports a mismatch carrying the PR head, so the message can name both', () => {
    const other = 'b'.repeat(40);
    expect(classifyHeadSha(SHA, other)).toEqual({ kind: 'mismatch', prHead: other });
  });

  it('treats an unknown PR head as fine rather than blocking', () => {
    // Fail-open on purpose: refusing to watch CI because `gh` hiccuped is a
    // worse outcome than the rare drift this check exists to catch.
    expect(classifyHeadSha(SHA, undefined)).toEqual({ kind: 'unknown' });
  });
});

describe('confirmHeadSha', () => {
  const SHA = 'a'.repeat(40);
  const OTHER = 'b'.repeat(40);
  const noWait = async () => {};

  it('re-reads once before believing a mismatch, absorbing push propagation', async () => {
    // Measured: pulls/N.head.sha trailed a push by ~1.4s (old SHA at 680ms,
    // current at 1379ms). A first-read refusal would reject a monitor armed
    // that fast after pushing.
    let call = 0;
    const fetch = () => (call++ === 0 ? OTHER : SHA);
    await expect(confirmHeadSha(SHA, 1995, fetch, noWait)).resolves.toEqual({ kind: 'match' });
    expect(call).toBe(2);
  });

  it('still refuses when the mismatch persists — real drift does not self-heal', async () => {
    await expect(confirmHeadSha(SHA, 1995, () => OTHER, noWait)).resolves.toEqual({
      kind: 'mismatch',
      prHead: OTHER,
    });
  });

  it('does not re-read when the first answer already agrees', async () => {
    let call = 0;
    await confirmHeadSha(
      SHA,
      1995,
      () => {
        call++;
        return SHA;
      },
      noWait
    );
    expect(call).toBe(1);
  });
});

describe('describeHeadMismatch', () => {
  it('names both SHAs and why nothing else would have caught it', () => {
    const message = describeHeadMismatch(1994, 'a'.repeat(40), 'b'.repeat(40));
    expect(message).toContain('a'.repeat(40));
    expect(message).toContain('b'.repeat(40));
    expect(message).toContain('#1994');
    expect(message).toMatch(/branch checkout/);
  });

  it('offers the cause as a candidate rather than asserting it', () => {
    // The gate cannot observe WHY the SHAs differ. A mismatch surviving the
    // re-check is usually a moved HEAD, but replication slower than
    // HEAD_RECHECK_MS — a bound set from one measurement — produces the same
    // symptom. Naming one cause as fact would send the reader after the wrong
    // fix (00-critical.md § Don't Present Speculation as Fact).
    const message = describeHeadMismatch(1994, 'a'.repeat(40), 'b'.repeat(40));
    expect(message).toMatch(/replication/);
    expect(message).toMatch(/re-read once/);
  });
});

describe('gitHasCommit timeout wiring', () => {
  it('passes COMMIT_CHECK_TIMEOUT_MS to the underlying git call', async () => {
    // The tests below run real git, so nothing there observes the option.
    vi.resetModules();
    const opts: Record<string, unknown>[] = [];
    vi.doMock('node:child_process', () => ({
      execFileSync: (_cmd: string, _args: string[], o: Record<string, unknown>) => {
        opts.push(o);
        return '';
      },
    }));
    const mod = await import('./ci-gate.js');
    mod.gitHasCommit('a'.repeat(40));
    vi.doUnmock('node:child_process');
    vi.resetModules();

    expect(opts).toHaveLength(1);
    expect(opts[0].timeout).toBe(mod.COMMIT_CHECK_TIMEOUT_MS);
  });

  it('answers TRUE on a timeout, so a busy git does not read as a bad SHA', async () => {
    // `false` here hard-aborts gate arming with "does not name a commit",
    // telling the caller to use `$(git rev-parse HEAD)` — which the mandated
    // invocation already does. Unknown must not impersonate not-found.
    vi.resetModules();
    vi.doMock('node:child_process', () => ({
      execFileSync: () => {
        const error = new Error('timed out') as Error & { code: string };
        error.code = 'ETIMEDOUT';
        throw error;
      },
    }));
    const mod = await import('./ci-gate.js');
    const result = mod.gitHasCommit('a'.repeat(40));
    vi.doUnmock('node:child_process');
    vi.resetModules();

    expect(result).toBe(true);
  });

  it('still answers FALSE for a genuinely absent commit', async () => {
    // The check's actual purpose: a hand-completed SHA must still be rejected
    // before the gate burns its full timeout polling for a commit that isn't
    // there. The timeout carve-out must not weaken this.
    vi.resetModules();
    vi.doMock('node:child_process', () => ({
      execFileSync: () => {
        const error = new Error('not found') as Error & { status: number };
        error.status = 1;
        throw error;
      },
    }));
    const mod = await import('./ci-gate.js');
    const result = mod.gitHasCommit('b'.repeat(40));
    vi.doUnmock('node:child_process');
    vi.resetModules();

    expect(result).toBe(false);
  });
});

describe('gitHasCommit', () => {
  it('resolves HEAD of this repo', () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    expect(gitHasCommit(head)).toBe(true);
  });

  it('rejects a well-formed SHA that does not exist', () => {
    expect(gitHasCommit('0'.repeat(39) + '1')).toBe(false);
  });
});

describe('shouldReportError', () => {
  it('always reports the first failure', () => {
    expect(shouldReportError(1)).toBe(true);
  });

  it('stays quiet between throttle points', () => {
    expect([2, 3, 9].map(shouldReportError)).toEqual([false, false, false]);
  });

  it('reports again every Nth consecutive failure', () => {
    expect(shouldReportError(GATE_DEFAULTS.ERROR_REPEAT_EVERY)).toBe(true);
    expect(shouldReportError(GATE_DEFAULTS.ERROR_REPEAT_EVERY * 2)).toBe(true);
  });
});

describe('describeWaitState', () => {
  it('distinguishes "gh api is failing" from "nothing has registered yet"', () => {
    expect(describeWaitState(undefined)).toContain('gh api failing');
    expect(describeWaitState(parseGateState([]))).toContain('no runs registered');
  });

  it('names what is pending and whether the anchor is done', () => {
    const detail = describeWaitState(parseGateState([DONE('CI'), run('CodeQL', 'queued')]));
    expect(detail).toContain('CodeQL(queued)');
    expect(detail).toContain('anchor done');
  });
});

describe('waitForCi', () => {
  it('releases as soon as the state is releasable', async () => {
    const { deps, logs } = harness([[DONE('CI')]]);
    await expect(waitForCi('sha', deps)).resolves.toBe('releasable');
    expect(logs).toEqual([]); // healthy and fast → silent
  });

  it('keeps waiting through empty and partial states', async () => {
    const { deps, calls } = harness([[], [run('CI', 'in_progress')], [DONE('CI')]]);
    await expect(waitForCi('sha', deps)).resolves.toBe('releasable');
    expect(calls()).toBe(3);
  });

  it('reports a gh api failure immediately instead of waiting silently', async () => {
    const { deps, logs } = harness([new GhApiError('HTTP 401: Bad credentials'), [DONE('CI')]]);
    await waitForCi('sha', deps);
    expect(logs[0]).toContain('gh api failed (1x)');
    expect(logs[0]).toContain('Bad credentials');
  });

  it('throttles repeat failures but reports recovery', async () => {
    const failures = Array.from({ length: 12 }, () => new GhApiError('boom'));
    const { deps, logs } = harness([...failures, [DONE('CI')]]);
    await waitForCi('sha', deps);
    const failureLines = logs.filter(l => l.includes('gh api failed'));
    // 1st and 10th only — not one line per 30-second poll.
    expect(failureLines).toHaveLength(2);
    expect(logs.some(l => l.includes('recovered after 12'))).toBe(true);
  });

  it('exits early on a startup_failure rather than burning the whole timeout', async () => {
    const { deps, logs } = harness([[run('CI', 'completed', 'startup_failure')]]);
    await expect(waitForCi('sha', deps)).resolves.toBe('startup-failure');
    expect(logs[0]).toContain('died before dispatch');
  });

  it('emits a heartbeat so a slow gate is distinguishable from a dead one', async () => {
    const stalled = Array.from({ length: 40 }, () => [run('CI', 'in_progress')]);
    const { deps, logs } = harness([...stalled, [DONE('CI')]]);
    await waitForCi('sha', deps);
    const beats = logs.filter(l => l.startsWith('⏳'));
    expect(beats.length).toBeGreaterThan(0);
    expect(beats[0]).toContain('CI(in_progress)');
  });

  it('heartbeats "no data" through an outage spanning the interval', async () => {
    // The two halves — describeWaitState(undefined) and the healthy-slow
    // heartbeat — were each tested alone. This pins the actual scenario the
    // gate exists for: a broken gate must not read as a slow one, and over a
    // long outage the heartbeat is the only thing still speaking.
    const outage = Array.from({ length: 40 }, () => new GhApiError('HTTP 500'));
    const { deps, logs } = harness([...outage, [DONE('CI')]]);
    await waitForCi('sha', deps);
    const beats = logs.filter(l => l.startsWith('⏳'));
    expect(beats.length).toBeGreaterThan(0);
    expect(beats[0]).toContain('no data (gh api failing)');
  });

  it('gives up before the Monitor timeout and says so', async () => {
    const { deps, logs } = harness([[run('CI', 'in_progress')]], { repeatLast: true });
    await expect(waitForCi('sha', deps)).resolves.toBe('timeout');
    expect(logs.at(-1)).toContain('gave up');
  });

  it('bounds the give-up wait below the Monitor timeout', () => {
    // The gate must report its own timeout, not be killed mid-poll by Monitor.
    expect(GATE_DEFAULTS.MAX_WAIT_MS).toBeLessThan(1_800_000);
  });
});

describe('countReviewCycles', () => {
  /** Per-call scripted mock: countReviewCycles makes two differently-shaped calls. */
  async function withGh(
    responses: (args: string[]) => string,
    run: (mod: typeof import('./ci-gate.js')) => number
  ): Promise<{ result?: number; error?: unknown; calls: string[][] }> {
    vi.resetModules();
    const calls: string[][] = [];
    vi.doMock('node:child_process', () => ({
      execFileSync: (_cmd: string, args: string[]) => {
        calls.push(args);
        return responses(args);
      },
    }));
    const mod = await import('./ci-gate.js');
    let result: number | undefined;
    let error: unknown;
    try {
      result = run(mod);
    } catch (thrown) {
      error = thrown;
    }
    vi.doUnmock('node:child_process');
    vi.resetModules();
    return { result, error, calls };
  }

  /** The `gh pr view` half's real shape: head ref and creation stamp, tab-separated. */
  const PR_VIEW = 'my-branch\t2026-08-29T16:30:33Z\n';

  it('counts review WORKFLOW runs for the head branch, not claude[bot] comments', async () => {
    // The same login also posts from the @claude mention workflow, so a
    // comment-based count inflates on chatty threads — the workflow-run count
    // is the review-cycle signal.
    const { result, calls } = await withGh(
      args => (args[1] === 'view' ? PR_VIEW : '7'),
      mod => mod.countReviewCycles(2124)
    );
    expect(result).toBe(7);
    expect(calls[0].slice(0, 3)).toEqual(['pr', 'view', '2124']);
    expect(calls[1][1]).toContain(
      '/actions/workflows/claude-code-review.yml/runs?branch=my-branch'
    );
  });

  it('floors the run query at the PR creation time so a REUSED branch name cannot inflate it', async () => {
    // The observed failure: a release PR's head ref is `develop`, reused by
    // every release, so an unfloored count returned 594 against 1 real cycle
    // and tripped the cap warning on every single release.
    const { calls } = await withGh(
      args => (args[1] === 'view' ? 'develop\t2026-08-29T16:30:33Z\n' : '1'),
      mod => mod.countReviewCycles(2251)
    );
    expect(calls[0]).toContain('headRefName,createdAt');
    expect(calls[1][1]).toContain('&created=%3E%3D2026-08-29T16:30:33Z');
  });

  it('an empty head-branch answer throws rather than counting the wrong branch', async () => {
    const { error } = await withGh(
      args => (args[1] === 'view' ? '' : '3'),
      mod => mod.countReviewCycles(2124)
    );
    expect(String(error)).toContain('no head branch name');
  });

  it('a malformed creation stamp throws rather than querying an unfloored range', async () => {
    // Falling back to an unfloored query on a bad timestamp would silently
    // restore the 594-cycle bug — the loud failure is the safer default, and
    // reportReviewRounds already fails open on a throw.
    const { error } = await withGh(
      args => (args[1] === 'view' ? 'b\tnot-a-timestamp\n' : '3'),
      mod => mod.countReviewCycles(2124)
    );
    expect(String(error)).toContain('no usable creation timestamp');
  });

  it('a head ref with no creation stamp at all throws', async () => {
    // `@tsv` emits a lone field when createdAt is absent, so the split yields
    // undefined rather than an empty string — both must reach the same throw.
    const { error } = await withGh(
      args => (args[1] === 'view' ? 'b\n' : '3'),
      mod => mod.countReviewCycles(2124)
    );
    expect(String(error)).toContain('no usable creation timestamp');
  });

  it('an EMPTY run-count response throws instead of coercing to zero', async () => {
    // Number('') is 0 — uncaught, an empty stdout would read as "checked,
    // zero rounds" and skip the warning silently.
    const { error } = await withGh(
      args => (args[1] === 'view' ? PR_VIEW : ''),
      mod => mod.countReviewCycles(2124)
    );
    expect(String(error)).toContain('unparseable review-cycle count');
  });

  it('an unparseable run count throws with the payload named', async () => {
    const { error } = await withGh(
      args => (args[1] === 'view' ? PR_VIEW : 'not-a-number'),
      mod => mod.countReviewCycles(2124)
    );
    expect(String(error)).toContain('unparseable review-cycle count');
  });
});

describe('reportReviewRounds', () => {
  it('warns with the count and the hand-off pointer at the round-cap threshold, alongside the dispatch reminder', () => {
    const lines: string[] = [];
    reportReviewRounds(
      2124,
      m => lines.push(m),
      () => 6
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('REVIEW ROUNDS ARE DISPATCH WORK');
    expect(lines[1]).toContain('REVIEW_ROUND_CAP: 6 claude-review cycles on PR #2124');
    expect(lines[1]).toContain('/tzurot-review-response § 5a');
  });

  it('stays silent on the round-cap warning below its threshold, but still prints the dispatch reminder', () => {
    const lines: string[] = [];
    reportReviewRounds(
      2124,
      m => lines.push(m),
      () => 5
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('REVIEW ROUNDS ARE DISPATCH WORK');
    expect(lines.some(l => l.includes('REVIEW_ROUND_CAP'))).toBe(false);
  });

  it('prints the dispatch reminder at exactly one cycle — the boundary of the reminder threshold', () => {
    const lines: string[] = [];
    reportReviewRounds(
      2124,
      m => lines.push(m),
      () => 1
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('REVIEW ROUNDS ARE DISPATCH WORK');
    expect(lines[0]).toContain('dispatch');
    expect(lines[0]).toContain('§ 3a');
  });

  it('stays silent entirely at zero cycles', () => {
    const lines: string[] = [];
    reportReviewRounds(
      2124,
      m => lines.push(m),
      () => 0
    );
    expect(lines).toHaveLength(0);
  });

  it('a count failure prints only the unavailability line — no dispatch reminder, no cap warning', () => {
    // Fail-open is deliberate, but SILENT fail-open would read as under-cap —
    // the line is the difference between "checked, fine" and "did not check".
    const lines: string[] = [];
    reportReviewRounds(
      2124,
      m => lines.push(m),
      () => {
        throw new Error('gh exploded');
      }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('review-cycle count unavailable');
    expect(lines[0]).toContain('gh exploded');
  });
});

describe('runCiGate (orchestration)', () => {
  const SHA = 'a'.repeat(40);

  // runCiGate sets process.exitCode on a non-releasable outcome; leaking that
  // would fail the whole vitest run. Returns what it was set to so the exit
  // code itself is ASSERTED, not merely contained — otherwise dropping or
  // inverting that line passes every test in this file.
  const captureExitCode = async (fn: () => Promise<void>): Promise<number | string | undefined> => {
    const prior = process.exitCode;
    process.exitCode = undefined;
    try {
      await fn();
      return process.exitCode;
    } finally {
      process.exitCode = prior;
    }
  };

  /** Records the ordered sequence of side effects so ordering can be asserted. */
  function orchestrationHarness(runs: WorkflowRun[]) {
    const events: string[] = [];
    let clock = 0;
    const overrides = {
      wait: {
        fetch: () => runs,
        now: () => clock,
        wait: async (ms: number) => {
          clock += ms;
        },
        log: (m: string) => events.push(`log:${m}`),
      },
      checks: (pr: number, watch: boolean) =>
        events.push(`checks:${pr}:${watch ? 'watch' : 'report'}`),
      settle: async (ms: number) => {
        events.push(`settle:${ms}`);
      },
      log: (m: string) => events.push(`log:${m}`),
      commitExists: () => true,
      prHead: () => SHA,
      // Hermetic: the default implementation shells out to gh.
      reviewRounds: (pr: number) => events.push(`reviewRounds:${pr}`),
    };
    return { events, overrides };
  }

  it('refuses to arm when --sha is not the PR head', async () => {
    // The window the substitution opened: HEAD moved (a branch checkout) between
    // the push and the arm. The SHA is real, so nothing else rejects it.
    const { overrides } = orchestrationHarness([DONE('CI')]);
    await expect(
      runCiGate(1992, { sha: SHA }, { ...overrides, prHead: () => 'b'.repeat(40) })
    ).rejects.toThrow(/is not the head of PR #1992/);
  });

  it('arms anyway when the PR head cannot be determined', async () => {
    const { events, overrides } = orchestrationHarness([DONE('CI')]);
    const exitCode = await captureExitCode(() =>
      runCiGate(1992, { sha: SHA }, { ...overrides, prHead: () => undefined })
    );
    expect(events).toContain('checks:1992:report');
    expect(events).toContain('log:⚠️  Could not read the PR head; arming without the drift check.');
    expect(exitCode).toBeUndefined();
  });

  it('fails open when the injected head fetcher THROWS, not just when it returns undefined', async () => {
    // The fail-open promise belongs to confirmHeadSha, not to fetchPrHeadSha's
    // internal catch — an override that throws must not surface as a stack
    // trace and stop the monitor arming.
    const { events, overrides } = orchestrationHarness([DONE('CI')]);
    const exitCode = await captureExitCode(() =>
      runCiGate(
        1992,
        { sha: SHA },
        {
          ...overrides,
          prHead: () => {
            throw new Error('gh exploded');
          },
        }
      )
    );
    expect(events).toContain('checks:1992:report');
    expect(exitCode).toBeUndefined();
  });

  it('settles between the watch handoff and the final report', async () => {
    // The old bash gate had `sleep 5` here; porting dropped it silently. The
    // final report reads the same eventually-consistent check-run index that
    // --watch just polled, so querying in the same instant can read a stale list.
    const { events, overrides } = orchestrationHarness([DONE('CI')]);
    const exitCode = await captureExitCode(() => runCiGate(1992, { sha: SHA }, overrides));
    const order = events.filter(e => !e.startsWith('log:⏱'));
    expect(order).toEqual([
      'checks:1992:watch',
      `settle:${GATE_DEFAULTS.SETTLE_MS}`,
      `log:${SENTINELS.releasable}`,
      'reviewRounds:1992',
      'checks:1992:report',
    ]);
    expect(exitCode).toBeUndefined(); // the happy path must not mark the run failed
  });

  it('emits a distinct sentinel and exit 1 when the gate gives up', async () => {
    // CI_COMPLETE here would read as a normal completion to anything scanning
    // for the sentinel — the gate always reaches the print now that it times
    // out at 25 min, below the Monitor's 30.
    const { events, overrides } = orchestrationHarness([run('CI', 'in_progress')]);
    const exitCode = await captureExitCode(() => runCiGate(1992, { sha: SHA }, overrides));
    expect(events).toContain(`log:${SENTINELS.timeout}`);
    expect(events).not.toContain(`log:${SENTINELS.releasable}`);
    // Round pressure is independent of CI state, so the count runs here too.
    expect(events).toContain('reviewRounds:1992');
    expect(events).toContain('checks:1992:report');
    expect(exitCode).toBe(1);
  });

  it('still reports checks on a startup_failure, without watching or settling', async () => {
    // Nothing to watch (the run created zero jobs) but the check list is still
    // the useful next datum, so the report must print either way.
    const { events, overrides } = orchestrationHarness([run('CI', 'completed', 'startup_failure')]);
    const exitCode = await captureExitCode(() => runCiGate(1992, { sha: SHA }, overrides));
    expect(events).not.toContain('checks:1992:watch');
    expect(events.some(e => e.startsWith('settle:'))).toBe(false);
    expect(events).toContain('checks:1992:report');
    expect(events).toContain(`log:${SENTINELS['startup-failure']}`);
    expect(events).toContain('reviewRounds:1992');
    expect(exitCode).toBe(1);
  });
});

describe('runChecks', () => {
  /** execFileSync throws for both cases; only one of them is worth reporting. */
  async function withGhFailure(thrown: unknown): Promise<string[]> {
    vi.resetModules();
    vi.doMock('node:child_process', () => ({
      execFileSync: () => {
        throw thrown;
      },
    }));
    const { runChecks } = await import('./ci-gate.js');
    const logs: string[] = [];
    runChecks(1992, false, (m: string) => logs.push(m));
    vi.doUnmock('node:child_process');
    vi.resetModules();
    return logs;
  }

  it('stays quiet on a nonzero exit — a red check is a report, not a failure', async () => {
    // `fixup-check` is intentionally red on a fixup-bearing branch; the report
    // still printed on stdout, so there is nothing to say.
    const exited = Object.assign(new Error('Command failed'), { status: 1 });
    expect(await withGhFailure(exited)).toEqual([]);
  });

  it('reports a spawn failure, which produces no report at all', async () => {
    // `gh` missing from PATH prints nothing after CI_COMPLETE, which would read
    // as "no checks" — the silent-failure mode this command exists to remove.
    const spawnFailed = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
    const logs = await withGhFailure(spawnFailed);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('could not run');
    expect(logs[0]).toContain('ENOENT');
  });
});

describe('runCiGate with its REAL dependencies (wiring seam)', () => {
  // Every other orchestration test injects a full overrides object, so the
  // `?? <default>` right-hand sides in runCiGate never execute — a swapped
  // `checks`/`settle`, or `log` not reaching `runChecks`, would pass all of
  // them and still break the real command. This runs the actual chain and
  // mocks ONLY the external boundary (02-code-standards.md § seam tests).
  it('drives fetchRuns → watch → settle → sentinel → report end to end', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const argvs: string[][] = [];
    vi.doMock('node:child_process', () => ({
      execFileSync: (_cmd: string, args: string[]) => {
        argvs.push(args);
        // Four distinct real calls: `git cat-file` (existence) returns empty;
        // `pulls/N` returns the PR head, which must MATCH or the gate refuses
        // to arm; the runs query returns a releasable state; `gh pr checks`
        // returns its report.
        // Tab-separated head ref + creation stamp — the `@tsv` shape the real
        // `gh pr view` emits; a bare branch name here would fail the timestamp
        // guard and silently skip the round-cap call this test asserts on.
        if (args[0] === 'pr' && args[1] === 'view') return 'feat-branch\t2026-08-29T16:30:33Z\n';
        if (args[0] !== 'api') return '';
        if (args[1].includes('/pulls/')) return 'A'.repeat(40);
        // The review-cycle count: at the cap, so the REAL warning path runs.
        if (args[1].includes('/actions/workflows/')) return '6';
        return JSON.stringify([DONE('CI')]);
      },
    }));
    const mod = await import('./ci-gate.js');
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((m: unknown) => {
      logs.push(String(m));
    });

    const promise = mod.runCiGate(1992, { sha: 'A'.repeat(40) });
    await vi.advanceTimersByTimeAsync(mod.GATE_DEFAULTS.SETTLE_MS);
    await promise;

    logSpy.mockRestore();
    vi.useRealTimers();
    vi.doUnmock('node:child_process');
    vi.resetModules();

    // The real settle ran (the promise only resolved after advancing the clock),
    // and every real dependency was reached in order.
    expect(argvs.map(a => a[0])).toEqual(['cat-file', 'api', 'api', 'pr', 'pr', 'api', 'pr']);
    expect(argvs[1][1]).toContain('/pulls/1992'); // head check precedes the wait
    expect(argvs[2][1]).toContain('head_sha=');
    expect(argvs[3]).toContain('--watch');
    expect(argvs[4]).toContain('view'); // round-cap: resolve the head branch after the sentinel
    expect(argvs[5][1]).toContain(
      '/actions/workflows/claude-code-review.yml/runs?branch=feat-branch' +
        '&created=%3E%3D2026-08-29T16:30:33Z'
    );
    expect(argvs[6]).not.toContain('--watch');
    expect(logs).toContain(mod.SENTINELS.releasable);
    expect(logs.some(l => l.includes('REVIEW_ROUND_CAP: 6'))).toBe(true);
    // The uppercase SHA was normalized before `git cat-file` AND before the
    // head comparison — an uppercase --sha must not read as drift.
    expect(argvs[0][2]).toBe(`${'a'.repeat(40)}^{commit}`);
  });

  it('drives the mismatch re-read through the REAL sleep-backed settle', async () => {
    // Every other retry test uses a synthetic no-op wait, so feeding the wrong
    // function into confirmHeadSha's `wait` — or never wiring it — would pass
    // all of them. This one only resolves once fake timers advance by
    // HEAD_RECHECK_MS, which proves the real `sleep` is what got threaded in.
    vi.resetModules();
    vi.useFakeTimers();
    let pullsCalls = 0;
    vi.doMock('node:child_process', () => ({
      execFileSync: (_cmd: string, args: string[]) => {
        if (args[0] !== 'api') return '';
        if (!args[1].includes('/pulls/')) return JSON.stringify([DONE('CI')]);
        pullsCalls += 1;
        return 'b'.repeat(40); // never agrees — a real, persistent mismatch
      },
    }));
    const mod = await import('./ci-gate.js');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const promise = mod.runCiGate(1992, { sha: 'a'.repeat(40) });
    const assertion = expect(promise).rejects.toThrow(/is not the head of PR #1992/);
    await vi.advanceTimersByTimeAsync(mod.GATE_DEFAULTS.HEAD_RECHECK_MS);
    await assertion;

    expect(pullsCalls).toBe(2); // read, waited, re-read
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.doUnmock('node:child_process');
    vi.resetModules();
  });

  it('threads `log` into fetchRuns so its page-ceiling warning reaches stdout', async () => {
    // A bare `fetch: fetchRuns` would send that one warning to console.warn
    // (stderr) instead, which is why this asserts the wiring rather than the
    // warning's text — the text is covered by fetchRuns' own test.
    vi.resetModules();
    vi.useFakeTimers();
    vi.doMock('node:child_process', () => ({
      execFileSync: (_cmd: string, args: string[]) => {
        if (args[0] !== 'api') return '';
        // Route the head check distinctly. Returning the runs payload for it
        // would fail FULL_SHA and drop into the fail-open branch — the test's
        // assertions would still pass while silently not exercising the head
        // check at all.
        return args[1].includes('/pulls/')
          ? 'a'.repeat(40)
          : JSON.stringify(Array.from({ length: GATE_PAGE_SIZE }, () => DONE('CI')));
      },
    }));
    const mod = await import('./ci-gate.js');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation(m => void stdout.push(String(m)));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(m => void stderr.push(String(m)));

    const promise = mod.runCiGate(1992, { sha: 'a'.repeat(40) });
    await vi.advanceTimersByTimeAsync(mod.GATE_DEFAULTS.SETTLE_MS);
    await promise;

    logSpy.mockRestore();
    warnSpy.mockRestore();
    vi.useRealTimers();
    vi.doUnmock('node:child_process');
    vi.resetModules();

    expect(stdout.some(l => l.includes('page ceiling'))).toBe(true);
    expect(stderr).toEqual([]);
  });
});

describe('the argv that actually reaches gh', () => {
  /**
   * The seam these tests cover is the argv array itself. Every other test drives
   * `fetchRuns`/`runChecks` through injected seams or error-path mocks, so a
   * dropped `--watch`, a mistyped query param, or a lost `--jq` would be
   * invisible — the abstraction would still behave.
   */
  async function captureArgv(
    run: (mod: typeof import('./ci-gate.js')) => void,
    stdout = '[]'
  ): Promise<string[][]> {
    vi.resetModules();
    const calls: string[][] = [];
    vi.doMock('node:child_process', () => ({
      execFileSync: (_cmd: string, args: string[]) => {
        calls.push(args);
        return stdout;
      },
    }));
    run(await import('./ci-gate.js'));
    vi.doUnmock('node:child_process');
    vi.resetModules();
    return calls;
  }

  it('queries the runs API pinned to the SHA, with the jq filter and page size', async () => {
    const sha = 'a'.repeat(40);
    const [args] = await captureArgv(mod => mod.fetchRuns(sha));
    expect(args).toEqual([
      'api',
      `repos/lbds137/tzurot/actions/runs?head_sha=${sha}&per_page=${GATE_PAGE_SIZE}`,
      '--jq',
      '.workflow_runs',
    ]);
  });

  it('warns when the result sits at the page ceiling', async () => {
    const full = JSON.stringify(Array.from({ length: GATE_PAGE_SIZE }, () => DONE('CI')));
    const warnings: string[] = [];
    await captureArgv(mod => mod.fetchRuns('a'.repeat(40), m => warnings.push(m)), full);
    expect(warnings[0]).toContain('page ceiling');
  });

  it('bounds the report pass but leaves the watch pass unbounded', async () => {
    // The watch pass is deliberately a long wait; a bound there would defeat
    // it. Only the single report call the agent reads carries a timeout.
    vi.resetModules();
    const opts: Record<string, unknown>[] = [];
    vi.doMock('node:child_process', () => ({
      execFileSync: (_cmd: string, _args: string[], o: Record<string, unknown>) => {
        opts.push(o);
        return '';
      },
    }));
    const mod = await import('./ci-gate.js');
    mod.runChecks(1992, true);
    mod.runChecks(1992, false);
    vi.doUnmock('node:child_process');
    vi.resetModules();

    expect(opts[0].timeout).toBeUndefined();
    expect(opts[1].timeout).toBe(mod.CHECKS_REPORT_TIMEOUT_MS);
  });

  it('watches with an explicit interval, then reports without watching', async () => {
    const calls = await captureArgv(mod => {
      mod.runChecks(1992, true);
      mod.runChecks(1992, false);
    });
    expect(calls).toEqual([
      ['pr', 'checks', '1992', '--watch', '--interval=30'],
      ['pr', 'checks', '1992'],
    ]);
  });
});

describe('fetchPrHeadSha', () => {
  /** Mirrors fetchRuns' error-path coverage — same fallback shape, same risk. */
  async function withGhResult(impl: () => string): Promise<string | undefined> {
    vi.resetModules();
    vi.doMock('node:child_process', () => ({ execFileSync: impl }));
    const { fetchPrHeadSha } = await import('./ci-gate.js');
    const result = fetchPrHeadSha(1995);
    vi.doUnmock('node:child_process');
    vi.resetModules();
    return result;
  }

  it('returns the lowercased SHA on success', async () => {
    await expect(withGhResult(() => `${'A'.repeat(40)}\n`)).resolves.toBe('a'.repeat(40));
  });

  it('returns undefined when gh throws, so the gate fails open', async () => {
    await expect(
      withGhResult(() => {
        throw new Error('HTTP 401: Bad credentials');
      })
    ).resolves.toBeUndefined();
  });

  it('returns undefined on a response that is not a SHA', async () => {
    // A `--jq` miss or an error body would otherwise be compared as a head SHA
    // and read as drift, refusing a perfectly good arm.
    await expect(withGhResult(() => 'null\n')).resolves.toBeUndefined();
  });

  it('bounds the call so a hang degrades to fail-open rather than silence', async () => {
    vi.resetModules();
    let opts: { timeout?: number } = {};
    vi.doMock('node:child_process', () => ({
      execFileSync: (_c: string, _a: string[], o: { timeout?: number }) => {
        opts = o;
        return 'a'.repeat(40);
      },
    }));
    const mod = await import('./ci-gate.js');
    mod.fetchPrHeadSha(1995);
    expect(opts.timeout).toBe(mod.HEAD_FETCH_TIMEOUT_MS);
    vi.doUnmock('node:child_process');
    vi.resetModules();
  });
});

describe('fetchRuns', () => {
  it('wraps a gh failure in GhApiError carrying the stderr first line', async () => {
    vi.resetModules();
    vi.doMock('node:child_process', () => ({
      execFileSync: () => {
        const err = new Error('Command failed') as Error & { stderr: string };
        err.stderr = 'gh: HTTP 403: rate limit exceeded\nmore noise';
        throw err;
      },
    }));
    const { fetchRuns } = await import('./ci-gate.js');
    // Assert on `.name`, not the class: resetModules gives this import its own
    // module instance, so its GhApiError is a different object than ours.
    expect(() => fetchRuns('a'.repeat(40))).toThrow(
      expect.objectContaining({ name: 'GhApiError' })
    );
    expect(() => fetchRuns('a'.repeat(40))).toThrow(/rate limit exceeded/);
    vi.doUnmock('node:child_process');
    vi.resetModules();
  });

  it('wraps unparseable output rather than crashing the loop', async () => {
    vi.resetModules();
    vi.doMock('node:child_process', () => ({ execFileSync: () => 'not json' }));
    const { fetchRuns } = await import('./ci-gate.js');
    expect(() => fetchRuns('a'.repeat(40))).toThrow(/unparseable response/);
    vi.doUnmock('node:child_process');
    vi.resetModules();
  });

  it('bounds the call so a hang cannot block the poll loop', async () => {
    // The catch below reports a timeout the same way it reports any other gh
    // failure, so the error path alone cannot tell a bounded call from an
    // unbounded one — only the options object can.
    vi.resetModules();
    let opts: { timeout?: number } = {};
    vi.doMock('node:child_process', () => ({
      execFileSync: (_c: string, _a: string[], o: { timeout?: number }) => {
        opts = o;
        return '[]';
      },
    }));
    const mod = await import('./ci-gate.js');
    mod.fetchRuns('a'.repeat(40));
    expect(opts.timeout).toBe(mod.RUNS_FETCH_TIMEOUT_MS);
    expect(typeof opts.timeout).toBe('number');
    vi.doUnmock('node:child_process');
    vi.resetModules();
  });

  it('reports a timeout kill with a non-empty detail naming the signal', async () => {
    // The shape execFileSync produces on timeout: no stderr, a bare "Command
    // failed" message, and the signal it was killed with. Reported blank, this
    // failure would be indistinguishable from the silence the gate removes.
    vi.resetModules();
    vi.doMock('node:child_process', () => ({
      execFileSync: () => {
        const err = new Error('Command failed: gh api repos/...') as Error & {
          stderr: string;
          status: null;
          signal: string;
        };
        err.stderr = '';
        err.status = null;
        err.signal = 'SIGTERM';
        throw err;
      },
    }));
    const { fetchRuns } = await import('./ci-gate.js');
    let thrown: unknown;
    try {
      fetchRuns('a'.repeat(40));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toEqual(expect.objectContaining({ name: 'GhApiError' }));
    expect((thrown as Error).message).not.toBe('');
    expect((thrown as Error).message).toContain('killed by SIGTERM');
    vi.doUnmock('node:child_process');
    vi.resetModules();
  });
});
