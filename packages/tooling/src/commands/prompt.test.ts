import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cac } from 'cac';

import { registerPromptCommands } from './prompt.js';

vi.mock('../utils/env-runner.js', () => ({
  validateEnvironment: vi.fn(),
}));

vi.mock('../prompt/voice-probes.js', () => ({
  parseDepthsOption: vi.fn().mockReturnValue([5, 10]),
}));

vi.mock('../prompt/mine-voice-probes.js', () => ({
  mineVoiceProbes: vi.fn().mockResolvedValue(undefined),
}));

// A real snowflake — the action reads --owner from raw argv (cac would lose
// precision on a digit-only value), so it has to be present there.
const OWNER = '278863839632818186';

describe('prompt:mine-voice-probes --count validation', () => {
  let cli: ReturnType<typeof cac>;
  let originalArgv: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    originalArgv = process.argv;
    process.argv = ['node', 'ops', 'prompt:mine-voice-probes', '--owner', OWNER];
    cli = cac('test');
    registerPromptCommands(cli);
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  async function runWithCount(count: string): Promise<void> {
    cli.parse(
      [
        'node',
        'test',
        'prompt:mine-voice-probes',
        '--env',
        'dev',
        '--owner',
        OWNER,
        '--count',
        count,
      ],
      { run: false }
    );
    await (cli.runMatchedCommand() as Promise<void>);
  }

  // The defect this closes was silent, not loud: an unvalidated NaN reached
  // pickPersonalities, whose `count < 1` guard is FALSE for NaN, so it fell
  // through to `ranked.slice(0, NaN)` — mining zero personalities and
  // reporting success. A mined run of nothing looks like a mined run.
  it('rejects a non-numeric count instead of silently mining zero personalities', async () => {
    const { mineVoiceProbes } = await import('../prompt/mine-voice-probes.js');

    await expect(runWithCount('abc')).rejects.toThrow('--count must be an integer, got: "abc"');
    expect(mineVoiceProbes).not.toHaveBeenCalled();
  });

  it('rejects a zero count, which would mine nothing by construction', async () => {
    const { mineVoiceProbes } = await import('../prompt/mine-voice-probes.js');

    await expect(runWithCount('0')).rejects.toThrow('--count must be at least 1, got: 0');
    expect(mineVoiceProbes).not.toHaveBeenCalled();
  });

  it('forwards a valid count through to the miner', async () => {
    const { mineVoiceProbes } = await import('../prompt/mine-voice-probes.js');

    await runWithCount('6');

    expect(mineVoiceProbes).toHaveBeenCalledWith(expect.objectContaining({ personalityCount: 6 }));
  });

  it('leaves count undefined when the flag is omitted, so the miner default applies', async () => {
    const { mineVoiceProbes } = await import('../prompt/mine-voice-probes.js');

    cli.parse(['node', 'test', 'prompt:mine-voice-probes', '--env', 'dev', '--owner', OWNER], {
      run: false,
    });
    await (cli.runMatchedCommand() as Promise<void>);

    expect(mineVoiceProbes).toHaveBeenCalledWith(
      expect.objectContaining({ personalityCount: undefined })
    );
  });
});
