import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cac } from 'cac';

import { registerDevCommands } from './dev.js';

vi.mock('../dev/stale-debug-audit.js', () => ({
  runStaleDebugAudit: vi.fn(),
}));

vi.mock('../dev/unit-closeout.js', () => ({
  unitCloseout: vi.fn(() => ({ ok: true, lines: [] })),
}));

vi.mock('../dev/worktree-transfer.js', () => ({
  transferWorktree: vi.fn(() => ({ ok: true, stat: '' })),
}));

describe('dev:stale-debug --max-age-days validation', () => {
  let cli: ReturnType<typeof cac>;

  beforeEach(() => {
    vi.clearAllMocks();
    cli = cac('test');
    registerDevCommands(cli);
  });

  async function run(...args: string[]): Promise<void> {
    cli.parse(['node', 'test', 'dev:stale-debug', ...args], { run: false });
    await (cli.runMatchedCommand() as Promise<void>);
  }

  // Defense in depth rather than a gap-closer: runStaleDebugAudit already
  // rejects a non-finite maxAgeDays. This pins that the CLI layer refuses
  // first, so the operator gets a flag-named message instead of one about an
  // internal argument.
  it('rejects a non-integer max-age-days at the CLI layer', async () => {
    const { runStaleDebugAudit } = await import('../dev/stale-debug-audit.js');

    await expect(run('--max-age-days', 'abc')).rejects.toThrow(
      '--max-age-days must be an integer, got: "abc"'
    );
    expect(runStaleDebugAudit).not.toHaveBeenCalled();
  });

  it('forwards a valid max-age-days to the audit', async () => {
    const { runStaleDebugAudit } = await import('../dev/stale-debug-audit.js');

    await run('--max-age-days', '30');

    expect(runStaleDebugAudit).toHaveBeenCalledWith(expect.objectContaining({ maxAgeDays: 30 }));
  });

  it('leaves max-age-days undefined when omitted, so the audit default applies', async () => {
    const { runStaleDebugAudit } = await import('../dev/stale-debug-audit.js');

    await run();

    expect(runStaleDebugAudit).toHaveBeenCalledWith(
      expect.objectContaining({ maxAgeDays: undefined })
    );
  });
});

// cac (via mri) number-coerces an all-digit option value at tokenize time, so
// a SHA like `1234567` arrives as a Number on `options.sha`/`options.base`
// rather than a string — the same class the snowflake-flag helper exists
// for. `unit:closeout` and `worktree:transfer` read these two flags from raw
// argv instead, mirroring `gh:ci-gate`'s `--sha` handling.
describe('unit:closeout / worktree:transfer --sha and --base raw-argv parsing', () => {
  let cli: ReturnType<typeof cac>;

  beforeEach(() => {
    vi.clearAllMocks();
    cli = cac('test');
    registerDevCommands(cli);
  });

  // `rawOptionValue` reads `process.argv` directly (not cac's parsed
  // options), so the args under test must actually BE `process.argv` while
  // the command runs — the same seam `gh:ci-gate`'s own test covers.
  async function run(...args: string[]): Promise<void> {
    const priorArgv = process.argv;
    process.argv = ['node', 'test', ...args];
    try {
      cli.parse(process.argv, { run: false });
      await (cli.runMatchedCommand() as Promise<void>);
    } finally {
      process.argv = priorArgv;
    }
  }

  it('reaches unitCloseout with an all-digit --sha as a string, no throw', async () => {
    const { unitCloseout } = await import('../dev/unit-closeout.js');

    await run('unit:closeout', 'TASK-1', '--pr', '5', '--sha', '1234567');

    expect(unitCloseout).toHaveBeenCalledWith(expect.objectContaining({ sha: '1234567' }));
  });

  it('reaches transferWorktree with an all-digit --base as a string', async () => {
    const { transferWorktree } = await import('../dev/worktree-transfer.js');

    await run('worktree:transfer', '.claude/worktrees/agent-xyz', '--base', '1234567');

    expect(transferWorktree).toHaveBeenCalledWith(expect.objectContaining({ base: '1234567' }));
  });

  it('still raises UsageError on a malformed --sha', async () => {
    const { unitCloseout } = await import('../dev/unit-closeout.js');

    await expect(run('unit:closeout', 'TASK-1', '--pr', '5', '--sha', 'xyz')).rejects.toThrow(
      '--sha must be a 7–40 character hex commit SHA'
    );
    expect(unitCloseout).not.toHaveBeenCalled();
  });

  it('still raises UsageError on an empty --sha', async () => {
    const { unitCloseout } = await import('../dev/unit-closeout.js');

    await expect(run('unit:closeout', 'TASK-1', '--pr', '5', '--sha', '')).rejects.toThrow(
      '--sha <merge-sha> is required'
    );
    expect(unitCloseout).not.toHaveBeenCalled();
  });
});
