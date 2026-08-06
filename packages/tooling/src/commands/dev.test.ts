import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cac } from 'cac';

import { registerDevCommands } from './dev.js';

vi.mock('../dev/stale-debug-audit.js', () => ({
  runStaleDebugAudit: vi.fn(),
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
