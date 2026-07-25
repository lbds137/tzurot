import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const execFileSync = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFileSync }));

const { describeMeasuredRef, formatMeasuredRef } = await import('./measured-ref.js');

/** Route each git invocation by its subcommand so tests read declaratively. */
function stubGit(responses: { sha?: string | Error; refs?: string | Error }): void {
  execFileSync.mockImplementation((_cmd: string, args: string[]) => {
    const answer = args[0] === 'rev-parse' ? responses.sha : responses.refs;
    if (answer === undefined) {
      throw new Error('git failed');
    }
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  });
}

describe('describeMeasuredRef', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves the short sha and the remote branch pointing at HEAD', () => {
    stubGit({ sha: '96d0384a2\n', refs: 'origin/develop\n' });

    expect(describeMeasuredRef('/repo')).toEqual({
      sha: '96d0384a2',
      remoteRefs: ['origin/develop'],
    });
  });

  it('passes argument arrays to git, never an interpolated string', () => {
    stubGit({ sha: 'abc1234', refs: 'origin/main' });

    describeMeasuredRef('/repo');

    for (const call of execFileSync.mock.calls) {
      expect(call[0]).toBe('git');
      expect(Array.isArray(call[1])).toBe(true);
      expect(call[2]).toMatchObject({ cwd: '/repo' });
    }
  });

  it('drops origin/HEAD, which mirrors the default branch and labels nothing', () => {
    stubGit({ sha: 'abc1234', refs: 'origin/HEAD\norigin/main\n' });

    expect(describeMeasuredRef('/repo').remoteRefs).toEqual(['origin/main']);
  });

  it('reports no remote branch when the commit is unpushed', () => {
    stubGit({ sha: 'abc1234', refs: '' });

    expect(describeMeasuredRef('/repo').remoteRefs).toEqual([]);
  });

  it('treats empty git output as no answer, so the annotation never renders a hole', () => {
    // A git call that succeeds with empty stdout would otherwise yield '',
    // which passes a `!== null` check and reaches the formatter as a gap:
    // `_Measured:  (no matching remote branch)_`.
    stubGit({ sha: '', refs: '' });

    const ref = describeMeasuredRef('/repo');

    expect(ref.sha).toBeNull();
    expect(formatMeasuredRef(ref)).toBe('_Measured: ref unavailable (git not readable)_');
  });

  it('keeps every remote branch when several point at the same commit', () => {
    // Happens in a full clone after a develop→main fast-forward. NOT reachable
    // in the weekly workflow, whose checkout fetches only the one requested
    // ref — this pins the pure function's behaviour, not a pipeline scenario.
    stubGit({ sha: 'abc1234', refs: 'origin/develop\norigin/main\n' });

    expect(describeMeasuredRef('/repo').remoteRefs).toEqual(['origin/develop', 'origin/main']);
  });

  it('returns a null sha rather than throwing when git is unreadable', () => {
    stubGit({ sha: new Error('not a git repository'), refs: new Error('nope') });

    expect(describeMeasuredRef('/repo')).toEqual({ sha: null, remoteRefs: [] });
  });
});

describe('formatMeasuredRef', () => {
  it('names the branch and sha when both resolve', () => {
    expect(formatMeasuredRef({ sha: '96d0384a2', remoteRefs: ['origin/develop'] })).toBe(
      '_Measured: origin/develop @ 96d0384a2_'
    );
  });

  it('states the sha and says so when no remote branch matches', () => {
    expect(formatMeasuredRef({ sha: 'abc1234', remoteRefs: [] })).toBe(
      '_Measured: abc1234 (no matching remote branch)_'
    );
  });

  it('degrades to an explicit unavailable rather than implying a branch', () => {
    const text = formatMeasuredRef({ sha: null, remoteRefs: [] });

    expect(text).toBe('_Measured: ref unavailable (git not readable)_');
    // The failure mode this guards: silently reading as the reader's own branch.
    expect(text).not.toContain('origin/');
  });
});
