import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cac } from 'cac';

import { registerCacheCommands, resolveDivergenceChars } from './cache.js';

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

    await expect(runWithLimit('0')).rejects.toThrow('--limit must be at least 1, got: 0');
    expect(runPrefixDiff).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric limit rather than letting NaN skip the cap check', async () => {
    const { runPrefixDiff } = await import('../cache/prefix-diff.js');

    await expect(runWithLimit('abc')).rejects.toThrow('--limit must be an integer, got: "abc"');
    expect(runPrefixDiff).not.toHaveBeenCalled();
  });
});

describe('cache:prefix-diff --show-divergence through the real cac parser', () => {
  let cli: ReturnType<typeof cac>;
  let originalArgv: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    originalArgv = process.argv;
    process.argv = ['node', 'ops', 'cache:prefix-diff', '--channel', CHANNEL];
    cli = cac('test');
    registerCacheCommands(cli);
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  async function runWithArgs(extra: string[]): Promise<void> {
    cli.parse(['node', 'test', 'cache:prefix-diff', '--env', 'dev', ...extra], { run: false });
    await (cli.runMatchedCommand() as Promise<void>);
  }

  // These exercise cac itself, not just resolveDivergenceChars. `[chars]`
  // (optional-value) is the only use of that option syntax in this package, so
  // nothing else in the repo pins what cac actually hands back for it — and
  // `resolveDivergenceChars` is built entirely on an assumption about that.
  // Probed directly before these were written: bare -> `true`, valued -> a
  // NUMBER (cac coerces), absent -> undefined.

  it('reads a BARE --show-divergence as the default width (the documented usage)', async () => {
    const { runPrefixDiff } = await import('../cache/prefix-diff.js');

    await runWithArgs(['--show-divergence']);

    expect(runPrefixDiff).toHaveBeenCalledWith(expect.objectContaining({ showDivergence: 240 }));
  });

  it('reads an explicit width, which cac hands over already number-coerced', async () => {
    const { runPrefixDiff } = await import('../cache/prefix-diff.js');

    await runWithArgs(['--show-divergence', '600']);

    expect(runPrefixDiff).toHaveBeenCalledWith(expect.objectContaining({ showDivergence: 600 }));
  });

  it('leaves the window off when the flag is absent', async () => {
    const { runPrefixDiff } = await import('../cache/prefix-diff.js');

    await runWithArgs([]);

    expect(runPrefixDiff).toHaveBeenCalledWith(
      expect.objectContaining({ showDivergence: undefined })
    );
  });

  it('honours --no-show-divergence, which cac turns into false', async () => {
    // Probed before writing this: cac negates an optional-value flag to the
    // boolean `false`, which is why resolveDivergenceChars handles that shape
    // at all. The unit test asserted the handling; this asserts the premise.
    const { runPrefixDiff } = await import('../cache/prefix-diff.js');

    await runWithArgs(['--no-show-divergence']);

    expect(runPrefixDiff).toHaveBeenCalledWith(
      expect.objectContaining({ showDivergence: undefined })
    );
  });

  it('accepts the equals-joined form, including an empty value', async () => {
    // Probed: cac reads `--flag=600` as 600 and a bare `--flag=` as `true`,
    // i.e. the default width rather than an empty string. Both are spellings an
    // operator will actually type, and neither is covered by the space form.
    const { runPrefixDiff } = await import('../cache/prefix-diff.js');

    await runWithArgs(['--show-divergence=600']);
    expect(runPrefixDiff).toHaveBeenCalledWith(expect.objectContaining({ showDivergence: 600 }));

    vi.clearAllMocks();
    await runWithArgs(['--show-divergence=']);
    expect(runPrefixDiff).toHaveBeenCalledWith(expect.objectContaining({ showDivergence: 240 }));
  });

  it('rejects a non-numeric width end-to-end', async () => {
    const { runPrefixDiff } = await import('../cache/prefix-diff.js');

    await expect(runWithArgs(['--show-divergence', 'wide'])).rejects.toThrow(
      '--show-divergence must be an integer, got: "wide"'
    );
    expect(runPrefixDiff).not.toHaveBeenCalled();
  });
});

describe('resolveDivergenceChars', () => {
  it('is off when the flag is absent', () => {
    expect(resolveDivergenceChars(undefined)).toBeUndefined();
    expect(resolveDivergenceChars(false)).toBeUndefined();
  });

  it('reads a bare flag as the default width', () => {
    // cac hands an optional-value flag through as `true` when no value follows
    // it. That spelling is the documented way to ask for the default, so it
    // must NOT reach parseIntFlag — which would reject it as a non-integer.
    expect(resolveDivergenceChars(true)).toBe(240);
  });

  it("honours an explicit width, as a string or as cac's coerced number", () => {
    expect(resolveDivergenceChars('600')).toBe(600);
    expect(resolveDivergenceChars(600)).toBe(600);
  });

  it('accepts a width exactly at the cap', () => {
    expect(resolveDivergenceChars('4000')).toBe(4000);
  });

  it('rejects a width past the cap rather than flooding the terminal', () => {
    expect(() => resolveDivergenceChars('99999')).toThrow('--show-divergence');
  });

  it('rejects a non-numeric width', () => {
    expect(() => resolveDivergenceChars('wide')).toThrow(
      '--show-divergence must be an integer, got: "wide"'
    );
  });
});
