import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cac } from 'cac';

import { registerDeployCommands } from './deploy.js';

// The action dynamically imports the maintenance runner, which would talk to
// Railway and Redis; stubbing it lets the flag validation run with no
// external contact.
vi.mock('../deployment/maintenance.js', () => ({
  runMaintenance: vi.fn().mockResolvedValue(0),
}));

vi.mock('../deployment/logs.js', () => ({
  fetchLogs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../deployment/var-delete.js', () => ({
  runVarDelete: vi.fn().mockResolvedValue(undefined),
}));

describe('maintenance --drain-timeout validation', () => {
  let cli: ReturnType<typeof cac>;

  beforeEach(() => {
    vi.clearAllMocks();
    cli = cac('test');
    registerDeployCommands(cli);
  });

  /**
   * cac's parse() discards the action's returned promise; runMatchedCommand()
   * returns it, which is what makes an async validation throw assertable.
   */
  async function runWithTimeout(timeout: string): Promise<void> {
    cli.parse(
      ['node', 'test', 'maintenance', 'status', '--env', 'dev', '--drain-timeout', timeout],
      { run: false }
    );
    await (cli.runMatchedCommand() as Promise<void>);
  }

  // The behaviour change this pins: a malformed value used to fall back to the
  // 120s default, which hid the fact that the operator's intended window was
  // never applied — on the one command that runs during a destructive prod
  // migration.
  it('aborts on a non-numeric timeout instead of falling back to the default', async () => {
    const { runMaintenance } = await import('../deployment/maintenance.js');

    await expect(runWithTimeout('garbage')).rejects.toThrow(
      '--drain-timeout must be an integer, got: "garbage"'
    );
    expect(runMaintenance).not.toHaveBeenCalled();
  });

  it('aborts on a zero timeout, which would make the drain wait meaningless', async () => {
    const { runMaintenance } = await import('../deployment/maintenance.js');

    await expect(runWithTimeout('0')).rejects.toThrow('--drain-timeout must be at least 1, got: 0');
    expect(runMaintenance).not.toHaveBeenCalled();
  });

  it('forwards a valid timeout through to the runner', async () => {
    const { runMaintenance } = await import('../deployment/maintenance.js');

    await runWithTimeout('300');

    expect(runMaintenance).toHaveBeenCalledWith(
      'status',
      expect.objectContaining({ drainTimeoutSec: 300 })
    );
  });

  it('rejects a non-integer --lines on the logs command', async () => {
    // Same coercion change as --drain-timeout, on the other deploy.ts flag.
    const { fetchLogs } = await import('../deployment/logs.js');
    cli.parse(['node', 'test', 'logs', '--env', 'dev', '--lines', 'abc'], { run: false });

    await expect(cli.runMatchedCommand() as Promise<void>).rejects.toThrow(
      '--lines must be an integer, got: "abc"'
    );
    expect(fetchLogs).not.toHaveBeenCalled();
  });

  it('applies the declared default when the flag is omitted', async () => {
    const { runMaintenance } = await import('../deployment/maintenance.js');

    cli.parse(['node', 'test', 'maintenance', 'status', '--env', 'dev'], { run: false });
    await (cli.runMatchedCommand() as Promise<void>);

    expect(runMaintenance).toHaveBeenCalledWith(
      'status',
      expect.objectContaining({ drainTimeoutSec: 120 })
    );
  });
});

describe('deploy:var-delete validation', () => {
  let cli: ReturnType<typeof cac>;

  beforeEach(() => {
    vi.clearAllMocks();
    cli = cac('test');
    registerDeployCommands(cli);
  });

  async function runVarDeleteCli(args: string[]): Promise<void> {
    cli.parse(['node', 'test', 'deploy:var-delete', ...args], { run: false });
    await (cli.runMatchedCommand() as Promise<void>);
  }

  it('rejects an --env that is neither dev nor prod', async () => {
    const { runVarDelete } = await import('../deployment/var-delete.js');

    await expect(
      runVarDeleteCli(['--env', 'staging', '--name', 'SOME_KEY', '--shared'])
    ).rejects.toThrow('--env must be "dev" or "prod"');
    expect(runVarDelete).not.toHaveBeenCalled();
  });

  it('rejects a missing --name', async () => {
    const { runVarDelete } = await import('../deployment/var-delete.js');

    await expect(runVarDeleteCli(['--env', 'dev', '--shared'])).rejects.toThrow(
      '--name <KEY> is required'
    );
    expect(runVarDelete).not.toHaveBeenCalled();
  });

  it('rejects when neither --service nor --shared is given', async () => {
    const { runVarDelete } = await import('../deployment/var-delete.js');

    await expect(runVarDeleteCli(['--env', 'dev', '--name', 'SOME_KEY'])).rejects.toThrow(
      'pass exactly one of --service <name> or --shared'
    );
    expect(runVarDelete).not.toHaveBeenCalled();
  });

  it('rejects when both --service and --shared are given', async () => {
    const { runVarDelete } = await import('../deployment/var-delete.js');

    await expect(
      runVarDeleteCli(['--env', 'dev', '--name', 'SOME_KEY', '--service', 'bot-client', '--shared'])
    ).rejects.toThrow('pass exactly one of --service <name> or --shared');
    expect(runVarDelete).not.toHaveBeenCalled();
  });

  it('maps --shared to service: null', async () => {
    const { runVarDelete } = await import('../deployment/var-delete.js');

    await runVarDeleteCli(['--env', 'dev', '--name', 'SOME_KEY', '--shared']);

    expect(runVarDelete).toHaveBeenCalledWith(expect.objectContaining({ service: null }));
  });

  it('maps --service bot-client to service: "bot-client"', async () => {
    const { runVarDelete } = await import('../deployment/var-delete.js');

    await runVarDeleteCli(['--env', 'dev', '--name', 'SOME_KEY', '--service', 'bot-client']);

    expect(runVarDelete).toHaveBeenCalledWith(expect.objectContaining({ service: 'bot-client' }));
  });
});
