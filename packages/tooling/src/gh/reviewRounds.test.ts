import { describe, it, expect, vi } from 'vitest';
import { reportReviewRounds } from './reviewRounds.js';

describe('countReviewCycles', () => {
  /** Per-call scripted mock: countReviewCycles makes two differently-shaped calls. */
  async function withGh(
    responses: (args: string[]) => string,
    run: (mod: typeof import('./reviewRounds.js')) => number
  ): Promise<{ result?: number; error?: unknown; calls: string[][] }> {
    vi.resetModules();
    const calls: string[][] = [];
    vi.doMock('node:child_process', () => ({
      execFileSync: (_cmd: string, args: string[]) => {
        calls.push(args);
        return responses(args);
      },
    }));
    const mod = await import('./reviewRounds.js');
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
