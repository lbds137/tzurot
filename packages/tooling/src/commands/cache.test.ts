import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cac } from 'cac';

import { registerCacheCommands } from './cache.js';

// The action calls validateEnvironment (Railway CLI probe + process.exit) and
// dynamically imports the fetcher; both are stubbed so the bounds checks run
// with no Railway/Redis/DB contact.
vi.mock('../utils/env-runner.js', () => ({
  validateEnvironment: vi.fn(),
}));

vi.mock('../cache/prefix-diff.js', () => ({
  runPrefixDiff: vi.fn().mockResolvedValue(undefined),
}));

const CHANNEL = '123456789012345678';

describe('cache:prefix-diff --limit bounds', () => {
  let cli: ReturnType<typeof cac>;
  let originalArgv: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    originalArgv = process.argv;
    // --channel is read from the REAL process.argv, not cac's parsed options
    // (snowflake precision — see utils/cli-args.ts), so it has to be stubbed
    // there for the action to get past the required-channel guard.
    process.argv = ['node', 'ops', 'cache:prefix-diff', '--channel', CHANNEL];
    cli = cac('test');
    registerCacheCommands(cli);
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  /**
   * cac's parse() discards the action's returned promise; runMatchedCommand()
   * returns it, which is what makes an async validation throw assertable.
   */
  async function runWithLimit(limit: string): Promise<void> {
    cli.parse(['node', 'test', 'cache:prefix-diff', '--env', 'dev', '--limit', limit], {
      run: false,
    });
    await (cli.runMatchedCommand() as Promise<void>);
  }

  it('rejects a limit above the 100-pair cap', async () => {
    const { runPrefixDiff } = await import('../cache/prefix-diff.js');

    await expect(runWithLimit('101')).rejects.toThrow('--limit must be at most 100, got: 101');
    expect(runPrefixDiff).not.toHaveBeenCalled();
  });

  it('accepts a limit exactly at the cap', async () => {
    const { runPrefixDiff } = await import('../cache/prefix-diff.js');

    await runWithLimit('100');

    expect(runPrefixDiff).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: CHANNEL, limit: 100 })
    );
  });

  it('still rejects a non-positive limit (the lower bound is unchanged)', async () => {
    const { runPrefixDiff } = await import('../cache/prefix-diff.js');

    await expect(runWithLimit('0')).rejects.toThrow('--limit must be a positive integer, got: 0');
    expect(runPrefixDiff).not.toHaveBeenCalled();
  });
});
