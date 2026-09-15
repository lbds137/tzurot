/**
 * Registration tests for the cadence command group: registration, option
 * shape, and what crosses the seam into ../dev/cadence.js (mocked here; the
 * ledger logic is tested in ../dev/cadence.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cac } from 'cac';
import { registerCadenceCommands } from './cadence.js';
import { runCadenceMark, runCadenceStatus } from '../dev/cadence.js';

vi.mock('../dev/cadence.js', () => ({
  runCadenceStatus: vi.fn().mockReturnValue(0),
  runCadenceMark: vi.fn().mockReturnValue(0),
}));

const mockRunCadenceStatus = vi.mocked(runCadenceStatus);
const mockRunCadenceMark = vi.mocked(runCadenceMark);

describe('registerCadenceCommands', () => {
  let cli: ReturnType<typeof cac>;

  beforeEach(() => {
    cli = cac('test');
    mockRunCadenceStatus.mockClear();
    mockRunCadenceMark.mockClear();
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('registers cadence:status and cadence:mark', () => {
    registerCadenceCommands(cli);

    const names = cli.commands.map(command => command.name);
    expect(names).toContain('cadence:status');
    expect(names).toContain('cadence:mark');
  });

  it('forwards --overdue-only to the status runner', async () => {
    registerCadenceCommands(cli);

    cli.parse(['node', 'test', 'cadence:status', '--overdue-only'], { run: false });
    await cli.runMatchedCommand();

    expect(mockRunCadenceStatus).toHaveBeenCalledWith({ overdueOnly: true });
    expect(process.exitCode).toBe(0);
  });

  it('forwards overdueOnly false when the flag is absent', async () => {
    registerCadenceCommands(cli);

    cli.parse(['node', 'test', 'cadence:status'], { run: false });
    await cli.runMatchedCommand();

    expect(mockRunCadenceStatus).toHaveBeenCalledWith({ overdueOnly: false });
  });

  it('forwards the name and a numeric-looking --date as a string to the mark runner', async () => {
    registerCadenceCommands(cli);

    cli.parse(['node', 'test', 'cadence:mark', 'arch-audit', '--date', '20260914'], { run: false });
    await cli.runMatchedCommand();

    expect(mockRunCadenceMark).toHaveBeenCalledWith({ name: 'arch-audit', date: '20260914' });
  });

  it('leaves date undefined without --date, and propagates the runner exit code', async () => {
    mockRunCadenceMark.mockReturnValueOnce(1);
    registerCadenceCommands(cli);

    cli.parse(['node', 'test', 'cadence:mark', 'nope'], { run: false });
    await cli.runMatchedCommand();

    expect(mockRunCadenceMark).toHaveBeenCalledWith({ name: 'nope', date: undefined });
    expect(process.exitCode).toBe(1);
  });
});
