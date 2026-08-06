/**
 * Registration tests for the secrets command group.
 *
 * Per the commands/ convention (see run.test.ts): registration and option
 * shape only — the implementation is tested in ../secrets/rotation.test.ts,
 * and cac action invocation is a thin dynamic-import wrapper.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cac } from 'cac';
import { registerSecretsCommands } from './secrets.js';

describe('registerSecretsCommands', () => {
  let cli: ReturnType<typeof cac>;

  beforeEach(() => {
    cli = cac('test');
  });

  it('registers the three secrets commands', () => {
    registerSecretsCommands(cli);

    const names = cli.commands.map(command => command.name);
    expect(names).toContain('secrets:mark-rotated');
    expect(names).toContain('secrets:rotation-status');
    expect(names).toContain('secrets:rotate-byok');
  });

  it('defaults every command to --env dev (prod is always explicit)', () => {
    registerSecretsCommands(cli);

    for (const name of ['secrets:mark-rotated', 'secrets:rotation-status', 'secrets:rotate-byok']) {
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
});
