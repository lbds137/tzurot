import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  BOARD_ONLY_PROBE_JOB,
  checkDevelopCi,
  releaseDevelopCi,
  type GhRunner,
} from './develop-ci.js';

interface FakeRun {
  id: number;
  conclusion: string | null;
  /** Defaults to `completed`. */
  status?: string;
  /** The probe job's conclusion; `skipped` marks a board-only run. */
  lint?: string;
  /** Overrides the whole job list (e.g. empty, or without the probe). */
  jobs?: { name: string; conclusion: string | null }[];
}

/** A runner serving a run list plus per-run job lists, recording each call. */
function fakeGh(runs: FakeRun[], calls: string[] = []): GhRunner {
  return args => {
    const path = args[1] ?? '';
    calls.push(path);
    if (path.includes('/workflows/ci.yml/runs')) {
      return JSON.stringify({
        workflow_runs: runs.map(r => ({
          id: r.id,
          head_sha: `${r.id}`.padEnd(40, 'a'),
          status: r.status ?? 'completed',
          conclusion: r.conclusion,
          html_url: `https://example.test/runs/${r.id}`,
        })),
      });
    }
    const match = /actions\/runs\/(\d+)\/jobs/.exec(path);
    const run = runs.find(r => `${r.id}` === match?.[1]);
    if (run === undefined) throw new Error(`unexpected call ${path}`);
    return JSON.stringify({
      jobs: run.jobs ?? [
        { name: 'changes', conclusion: 'success' },
        { name: BOARD_ONLY_PROBE_JOB, conclusion: run.lint ?? 'success' },
      ],
    });
  };
}

describe('checkDevelopCi', () => {
  it('queries develop push runs of ci.yml with a bounded page, without a status filter', () => {
    const calls: string[] = [];
    checkDevelopCi(fakeGh([{ id: 20, conclusion: 'success' }], calls));
    expect(calls[0]).toMatch(/\/actions\/workflows\/ci\.yml\/runs\?/);
    expect(calls[0]).toContain('branch=develop');
    expect(calls[0]).toContain('event=push');
    expect(calls[0]).toContain('per_page=30');
    expect(calls[0]).not.toContain('status=');
  });

  it('steps over a board-only tip and reports the code run that succeeded (exit 0)', () => {
    const result = checkDevelopCi(
      fakeGh([
        { id: 30, conclusion: 'success', lint: 'skipped' },
        { id: 20, conclusion: 'success' },
      ])
    );
    expect(result.exitCode).toBe(0);
    expect(result.message).toBe('success run 20 sha 20aaaaaaa https://example.test/runs/20');
  });

  it('reports a failed first non-board run (exit 1)', () => {
    const result = checkDevelopCi(
      fakeGh([
        { id: 30, conclusion: 'success', lint: 'skipped' },
        { id: 20, conclusion: 'failure' },
        { id: 10, conclusion: 'success' },
      ])
    );
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('failure run 20');
  });

  it('treats a cancelled non-board run as a finding, not as skippable (exit 1)', () => {
    const result = checkDevelopCi(
      fakeGh([
        { id: 30, conclusion: 'success', lint: 'skipped' },
        { id: 20, conclusion: 'cancelled' },
        { id: 10, conclusion: 'success' },
      ])
    );
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('cancelled run 20');
  });

  it('reports a null conclusion on a completed run as unknown (exit 1)', () => {
    const result = checkDevelopCi(fakeGh([{ id: 20, conclusion: null }]));
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('unknown run 20');
  });

  it('flags an in-progress code run as a finding (exit 1)', () => {
    const result = checkDevelopCi(
      fakeGh([{ id: 20, conclusion: null, status: 'in_progress', lint: 'in_progress' }])
    );
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('in_progress run 20');
  });

  it('steps over an in-progress board-only run to a completed success (exit 0)', () => {
    const result = checkDevelopCi(
      fakeGh([
        { id: 30, conclusion: null, status: 'in_progress', lint: 'skipped' },
        { id: 20, conclusion: 'success' },
      ])
    );
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain('success run 20');
  });

  it('refuses to classify a run that has jobs but no probe job (exit 3)', () => {
    const result = checkDevelopCi(
      fakeGh([{ id: 20, conclusion: 'success', jobs: [{ name: 'build', conclusion: 'success' }] }])
    );
    expect(result.exitCode).toBe(3);
    expect(result.message).toContain('no lint job in run 20');
  });

  it('reports a zero-jobs run (startup_failure) through its conclusion (exit 1)', () => {
    const result = checkDevelopCi(fakeGh([{ id: 20, conclusion: 'startup_failure', jobs: [] }]));
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('startup_failure run 20');
  });

  it('exits 2 when every run in the window is board-only', () => {
    const result = checkDevelopCi(
      fakeGh([
        { id: 30, conclusion: 'success', lint: 'skipped' },
        { id: 20, conclusion: 'success', lint: 'skipped' },
      ])
    );
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('last 2 CI runs');
  });

  it('walks newest first even when the API returns runs out of order, and stops at the first answer', () => {
    const calls: string[] = [];
    const result = checkDevelopCi(
      fakeGh(
        [
          { id: 10, conclusion: 'failure' },
          { id: 30, conclusion: 'success', lint: 'skipped' },
          { id: 20, conclusion: 'success' },
        ],
        calls
      )
    );
    expect(result.message).toContain('success run 20');
    expect(calls.some(c => c.includes('/runs/10/jobs'))).toBe(false);
  });
});

describe('releaseDevelopCi', () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('maps a throwing runner to exit 4 with a one-line stderr message', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    releaseDevelopCi(() => {
      throw new Error('gh: rate limited');
    });
    expect(process.exitCode).toBe(4);
    expect(err).toHaveBeenCalledWith('release:develop-ci failed: gh: rate limited');
  });

  it('maps malformed JSON to exit 4', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    releaseDevelopCi(() => 'not json');
    expect(process.exitCode).toBe(4);
  });

  it('prints the verdict on stdout and sets the exit code on a normal result', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    releaseDevelopCi(fakeGh([{ id: 20, conclusion: 'failure' }]));
    expect(process.exitCode).toBe(1);
    expect(log).toHaveBeenCalledWith('failure run 20 sha 20aaaaaaa https://example.test/runs/20');
  });
});
