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
});
