import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  GATE_DEFAULTS,
  GhApiError,
  describeWaitState,
  gitHasCommit,
  isReleasable,
  parseGateState,
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
    };
    return { events, overrides };
  }

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
        // `git cat-file` (existence check) returns empty; the runs query returns
        // a releasable state; `gh pr checks` returns its report.
        return args[0] === 'api' ? JSON.stringify([DONE('CI')]) : '';
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
    expect(argvs.map(a => a[0])).toEqual(['cat-file', 'api', 'pr', 'pr']);
    expect(argvs[2]).toContain('--watch');
    expect(argvs[3]).not.toContain('--watch');
    expect(logs).toContain(mod.SENTINELS.releasable);
    // The uppercase SHA was normalized before `git cat-file` saw it.
    expect(argvs[0][2]).toBe(`${'a'.repeat(40)}^{commit}`);
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
});
