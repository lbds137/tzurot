/**
 * Registration tests for the secrets command group.
 *
 * Per the commands/ convention (see run.test.ts): registration and option
 * shape only — the implementation is tested in ../secrets/rotation.test.ts,
 * and cac action invocation is a thin dynamic-import wrapper. Two exceptions:
 * `../secrets/rotate-env-secret.js` is mocked so the --name trim test below
 * can assert what crosses that seam without paying for a real rotation run,
 * and `../secrets/rotation.js` is mocked so the rotate-byok stage-forwarding
 * test can assert what crosses THAT seam the same way.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cac } from 'cac';
import { registerSecretsCommands } from './secrets.js';
import { runRotateEnvSecret } from '../secrets/rotate-env-secret.js';
import { rotateByokKey, markSecretRotated, showRotationStatus } from '../secrets/rotation.js';

vi.mock('../secrets/rotate-env-secret.js', () => ({
  runRotateEnvSecret: vi.fn().mockResolvedValue(undefined),
}));

// Enumerate every export `secrets.ts` dynamically imports from `rotation.js`
// (not a `{ ...actual }` spread — see 02-code-standards.md § Module
// Organization): `markSecretRotated` and `showRotationStatus` back the
// --interval/--env tests elsewhere in this file, and `rotateByokKey` backs
// the new --stage forwarding test below.
vi.mock('../secrets/rotation.js', () => ({
  rotateByokKey: vi.fn().mockResolvedValue(undefined),
  markSecretRotated: vi.fn().mockResolvedValue(undefined),
  showRotationStatus: vi.fn().mockResolvedValue(undefined),
}));

const mockRunRotateEnvSecret = vi.mocked(runRotateEnvSecret);
const mockRotateByokKey = vi.mocked(rotateByokKey);
const mockMarkSecretRotated = vi.mocked(markSecretRotated);
const mockShowRotationStatus = vi.mocked(showRotationStatus);

describe('registerSecretsCommands', () => {
  let cli: ReturnType<typeof cac>;

  beforeEach(() => {
    cli = cac('test');
    mockRunRotateEnvSecret.mockClear();
    mockRotateByokKey.mockClear();
    mockMarkSecretRotated.mockClear();
    mockShowRotationStatus.mockClear();
  });

  it('registers the four secrets commands', () => {
    registerSecretsCommands(cli);

    const names = cli.commands.map(command => command.name);
    expect(names).toContain('secrets:mark-rotated');
    expect(names).toContain('secrets:rotation-status');
    expect(names).toContain('secrets:rotate-byok');
    expect(names).toContain('secrets:rotate-env');
  });

  it('defaults every command to --env dev (prod is always explicit)', () => {
    registerSecretsCommands(cli);

    for (const name of [
      'secrets:mark-rotated',
      'secrets:rotation-status',
      'secrets:rotate-byok',
      'secrets:rotate-env',
    ]) {
      const command = cli.commands.find(c => c.name === name);
      const envOption = command?.options.find(option => option.name === 'env');
      expect(envOption?.config.default).toBe('dev');
    }
  });

  it('rotate-byok exposes the --stage option', () => {
    registerSecretsCommands(cli);

    const command = cli.commands.find(c => c.name === 'secrets:rotate-byok');
    expect(command?.options.find(option => option.name === 'stage')).toBeDefined();
  });

  // cac's underlying parser (mri) coerces a numeric-looking flag value to a
  // NUMBER, so `--stage 1` arrives as `1`, not `'1'` — this pins that
  // normalizeStageFlag converts it before it crosses the seam into
  // rotateByokKey, mirroring the rotate-env coverage below.
  it('forwards a numeric --stage 1 as the string "1" to rotateByokKey', async () => {
    registerSecretsCommands(cli);

    cli.parse(['node', 'test', 'secrets:rotate-byok', '--stage', '1'], { run: false });
    await cli.runMatchedCommand();

    expect(mockRotateByokKey).toHaveBeenCalledWith({ env: 'dev', stage: '1' });
  });

  // The action validates --stage before the dynamic import into
  // ../secrets/rotation.js, so a missing value fails here rather than
  // reaching that module at all — same no-mock shape as the --interval and
  // --name guards above.
  it('rejects secrets:rotate-byok with no --stage before loading the rotation module', async () => {
    registerSecretsCommands(cli);

    cli.parse(['node', 'test', 'secrets:rotate-byok'], { run: false });

    await expect(cli.runMatchedCommand() as Promise<void>).rejects.toThrow('--stage is required');
    expect(mockRotateByokKey).not.toHaveBeenCalled();
  });

  // The action validates --interval before the dynamic import, so a malformed
  // value fails here rather than as a NaN at the Prisma write. This is the one
  // action-level assertion in this file; the rest is registration shape per
  // the convention above.
  it('rejects a malformed --interval before loading the rotation module', async () => {
    registerSecretsCommands(cli);

    cli.parse(['node', 'test', 'secrets:mark-rotated', 'some-secret', '--interval', 'abc'], {
      run: false,
    });

    await expect(cli.runMatchedCommand() as Promise<void>).rejects.toThrow(
      '--interval must be an integer, got: "abc"'
    );
  });

  it('rejects a zero --interval, which would mark every secret perpetually overdue', async () => {
    registerSecretsCommands(cli);

    cli.parse(['node', 'test', 'secrets:mark-rotated', 'some-secret', '--interval', '0'], {
      run: false,
    });

    await expect(cli.runMatchedCommand() as Promise<void>).rejects.toThrow(
      '--interval must be at least 1, got: 0'
    );
  });

  // The action validates --name before the dynamic import into
  // ../secrets/rotate-env-secret.js, so a missing value fails here rather
  // than reaching that module at all. Same no-mock shape as the --interval
  // guards above — the guard runs before the dynamic import.
  it('rejects secrets:rotate-env with no --name before loading the rotation module', async () => {
    registerSecretsCommands(cli);

    cli.parse(['node', 'test', 'secrets:rotate-env'], { run: false });

    await expect(cli.runMatchedCommand() as Promise<void>).rejects.toThrow('--name is required');
  });

  it('rejects secrets:rotate-env with a whitespace-only --name', async () => {
    registerSecretsCommands(cli);

    cli.parse(['node', 'test', 'secrets:rotate-env', '--name', '   '], { run: false });

    await expect(cli.runMatchedCommand() as Promise<void>).rejects.toThrow('--name is required');
  });

  it('trims --name before it crosses the seam into the rotation runner', async () => {
    registerSecretsCommands(cli);

    cli.parse(
      ['node', 'test', 'secrets:rotate-env', '--name', '  INTERNAL_SERVICE_SECRET  ', '--yes'],
      { run: false }
    );
    await cli.runMatchedCommand();

    expect(mockRunRotateEnvSecret).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'INTERNAL_SERVICE_SECRET' })
    );
  });

  it('rotate-env exposes the --stage option', () => {
    registerSecretsCommands(cli);

    const command = cli.commands.find(c => c.name === 'secrets:rotate-env');
    expect(command?.options.find(option => option.name === 'stage')).toBeDefined();
  });

  // cac's underlying parser (mri) coerces a numeric-looking flag value to a
  // NUMBER, so `--stage 1` arrives as `1`, not `'1'` — this pins that the
  // seam still receives the STRING form after normalizeStageFlag.
  it('forwards a numeric --stage 1 as the string "1" to the rotation runner', async () => {
    registerSecretsCommands(cli);

    cli.parse(
      [
        'node',
        'test',
        'secrets:rotate-env',
        '--name',
        'INTERNAL_SERVICE_SECRET',
        '--stage',
        '1',
        '--yes',
      ],
      { run: false }
    );
    await cli.runMatchedCommand();

    expect(mockRunRotateEnvSecret).toHaveBeenCalledWith(expect.objectContaining({ stage: '1' }));
  });

  it('omits --stage entirely (undefined) when the flag is not given', async () => {
    registerSecretsCommands(cli);

    cli.parse(
      ['node', 'test', 'secrets:rotate-env', '--name', 'INTERNAL_SERVICE_SECRET', '--yes'],
      { run: false }
    );
    await cli.runMatchedCommand();

    expect(mockRunRotateEnvSecret).toHaveBeenCalledWith(
      expect.objectContaining({ stage: undefined })
    );
  });
});
