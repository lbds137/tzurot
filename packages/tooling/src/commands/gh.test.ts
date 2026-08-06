import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cac } from 'cac';

import { registerGhCommands } from './gh.js';

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
    vi.spyOn(console, 'error').mockImplementation(() => {});
    cli = cac('test');
    registerGhCommands(cli);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  async function run(command: string, number: string): Promise<void> {
    cli.parse(['node', 'test', command, number], { run: false });
    await (cli.runMatchedCommand() as Promise<void>);
  }

  // The early-return is the load-bearing half: without it a NaN would reach
  // the API as a literal `/pulls/NaN` path and fail with an opaque 404 rather
  // than a usage error.
  it('returns before the API call when the PR number is not a number', async () => {
    const { getPrInfo } = await import('../gh/github-api.js');

    await run('gh:pr-info', 'abc');

    expect(getPrInfo).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith('<number> must be an integer, got: "abc"');
  });

  it('returns before the API call when the PR number is zero', async () => {
    const { getPrReviews } = await import('../gh/github-api.js');

    await run('gh:pr-reviews', '0');

    expect(getPrReviews).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
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
    expect(process.exitCode).toBeUndefined();
  });

  // The guard was applied to six call sites by a scripted replace; this pins
  // that the multi-call command got it too, not just the single-call ones.
  it('guards the multi-call gh:pr-all command as well', async () => {
    const api = await import('../gh/github-api.js');

    await run('gh:pr-all', 'abc');

    expect(api.getPrInfo).not.toHaveBeenCalled();
    expect(api.getPrReviews).not.toHaveBeenCalled();
    expect(api.getPrLineComments).not.toHaveBeenCalled();
    expect(api.getPrIssueComments).not.toHaveBeenCalled();
  });
});
