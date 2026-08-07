import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cac } from 'cac';

import { registerGhCommands } from './gh.js';
import { UsageError } from '../utils/errors.js';

// Every gh command dynamically imports this module and hits the GitHub API
// through it; stubbing it lets the positional validation run offline, and
// makes "did the command return early?" directly assertable.
vi.mock('../gh/github-api.js', () => ({
  getPrInfo: vi.fn().mockReturnValue({ number: 1, title: 't', state: 'open', html_url: 'u' }),
  getPrReviews: vi.fn().mockReturnValue([]),
  getPrAllComments: vi.fn().mockReturnValue({ conversation: [], line: [] }),
  getPrIssueComments: vi.fn().mockReturnValue([]),
  getPrLineComments: vi.fn().mockReturnValue([]),
  editPr: vi.fn(),
  formatReviews: vi.fn().mockReturnValue(''),
  formatComments: vi.fn().mockReturnValue(''),
}));

describe('gh command PR-number validation', () => {
  let cli: ReturnType<typeof cac>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    cli = cac('test');
    registerGhCommands(cli);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function run(command: string, number: string): Promise<void> {
    cli.parse(['node', 'test', command, number], { run: false });
    await (cli.runMatchedCommand() as Promise<void>);
  }

  // Aborting before the call is the load-bearing half: without it a NaN would
  // reach the API as a literal `/pulls/NaN` path and fail with an opaque 404
  // rather than a usage error. The throw is what cli.ts renders as one line.
  it('throws a UsageError before the API call when the PR number is not a number', async () => {
    const { getPrInfo } = await import('../gh/github-api.js');

    await expect(run('gh:pr-info', 'abc')).rejects.toThrow(UsageError);

    expect(getPrInfo).not.toHaveBeenCalled();
  });

  it('names the offending positional in the message', async () => {
    await expect(run('gh:pr-info', 'abc')).rejects.toThrow(
      '<number> must be an integer, got: "abc"'
    );
  });

  it('throws before the API call when the PR number is zero', async () => {
    const { getPrReviews } = await import('../gh/github-api.js');

    await expect(run('gh:pr-reviews', '0')).rejects.toThrow('<number> must be at least 1, got: 0');

    expect(getPrReviews).not.toHaveBeenCalled();
  });

  // The absent-value case never reaches the action: cac rejects a missing
  // required positional first. This pins that upstream guarantee, because it
  // is what makes `parsePrNumber`'s own absent-value branch unreachable — if
  // `<number>` were ever loosened to the optional `[number]` form, this test
  // fails and points at the branch that then starts carrying real weight.
  it('is rejected by cac before the action runs when the number is missing', async () => {
    const { getPrInfo } = await import('../gh/github-api.js');

    cli.parse(['node', 'test', 'gh:pr-info'], { run: false });

    expect(() => cli.runMatchedCommand()).toThrow('missing required args');
    expect(getPrInfo).not.toHaveBeenCalled();
  });

  it('forwards a valid PR number to the API', async () => {
    const { getPrInfo } = await import('../gh/github-api.js');

    await run('gh:pr-info', '1985');

    expect(getPrInfo).toHaveBeenCalledWith(1985);
  });

  // The guard was applied to six call sites by a scripted replace; this pins
  // that the multi-call command got it too, not just the single-call ones.
  it('guards the multi-call gh:pr-all command as well', async () => {
    const api = await import('../gh/github-api.js');

    await expect(run('gh:pr-all', 'abc')).rejects.toThrow(UsageError);

    expect(api.getPrInfo).not.toHaveBeenCalled();
    expect(api.getPrReviews).not.toHaveBeenCalled();
    expect(api.getPrLineComments).not.toHaveBeenCalled();
    expect(api.getPrIssueComments).not.toHaveBeenCalled();
  });

  // gh:ci-gate is the 7th call site and doesn't go through github-api.js, so
  // the mock above can't prove it aborted. Its own module is stubbed instead:
  // a regression dropping `parsePrNumber` would let a bad number through to a
  // 25-minute wait against `/pulls/NaN`.
  it('guards gh:ci-gate before it can start waiting', async () => {
    vi.doMock('../gh/ci-gate.js', () => ({ runCiGate: vi.fn() }));
    const { runCiGate } = await import('../gh/ci-gate.js');

    await expect(run('gh:ci-gate', 'abc')).rejects.toThrow(UsageError);

    expect(runCiGate).not.toHaveBeenCalled();
    vi.doUnmock('../gh/ci-gate.js');
  });

  it('forwards --sha to gh:ci-gate read from raw argv', async () => {
    // The value crosses a seam the PR-number tests don't cover: it is read from
    // process.argv rather than cac's parsed options (mri coerces digit-only
    // values), so a wiring break here would be invisible to every other test.
    vi.doMock('../gh/ci-gate.js', () => ({ runCiGate: vi.fn() }));
    const { runCiGate } = await import('../gh/ci-gate.js');
    const sha = 'a'.repeat(40);
    const priorArgv = process.argv;
    process.argv = ['node', 'test', 'gh:ci-gate', '1992', '--sha', sha];
    try {
      cli.parse(process.argv, { run: false });
      await (cli.runMatchedCommand() as Promise<void>);
    } finally {
      process.argv = priorArgv;
    }

    expect(runCiGate).toHaveBeenCalledWith(1992, { sha });
    vi.doUnmock('../gh/ci-gate.js');
  });
});
