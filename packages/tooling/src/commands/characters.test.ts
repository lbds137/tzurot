/**
 * Registration tests for `characters:import`: the action's own usage-error
 * guards (--env / --dir missing) and that `--as-user` is read from raw argv,
 * not cac's parsed options (snowflake precision — see cli-args.ts). The
 * import/classify logic itself is covered in ../characters/import.test.ts
 * and ../characters/classify.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cac } from 'cac';
import { registerCharactersCommands } from './characters.js';
import { charactersImport } from '../characters/import.js';

vi.mock('../characters/import.js', () => ({
  charactersImport: vi.fn().mockResolvedValue(undefined),
}));

const mockCharactersImport = vi.mocked(charactersImport);

describe('registerCharactersCommands', () => {
  let cli: ReturnType<typeof cac>;
  let originalArgv: string[];

  beforeEach(() => {
    cli = cac('test');
    registerCharactersCommands(cli);
    mockCharactersImport.mockClear();
    originalArgv = process.argv;
  });

  afterEach(() => {
    process.exitCode = undefined;
    process.argv = originalArgv;
  });

  it('rejects a missing --env with exit code 1 and never calls charactersImport', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.argv = ['node', 'test', 'characters:import', '--dir', './cards'];

    cli.parse(['node', 'test', 'characters:import', '--dir', './cards'], { run: false });
    await cli.runMatchedCommand();

    expect(process.exitCode).toBe(1);
    expect(mockCharactersImport).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--env is required'));
    errorSpy.mockRestore();
  });

  it('rejects a missing --dir with exit code 1 and never calls charactersImport', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.argv = ['node', 'test', 'characters:import', '--env', 'dev'];

    cli.parse(['node', 'test', 'characters:import', '--env', 'dev'], { run: false });
    await cli.runMatchedCommand();

    expect(process.exitCode).toBe(1);
    expect(mockCharactersImport).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--dir is required'));
    errorSpy.mockRestore();
  });

  it('reads --as-user from raw argv rather than cac-parsed options', async () => {
    // A Discord snowflake exceeds Number.MAX_SAFE_INTEGER; cac/mri would
    // silently coerce it to a Number and corrupt its low digits if read from
    // the parsed options instead of raw argv.
    const asUser = '123456789012345678';
    process.argv = [
      'node',
      'test',
      'characters:import',
      '--env',
      'dev',
      '--dir',
      './cards',
      '--as-user',
      asUser,
    ];

    cli.parse(
      [
        'node',
        'test',
        'characters:import',
        '--env',
        'dev',
        '--dir',
        './cards',
        '--as-user',
        asUser,
      ],
      { run: false }
    );
    await cli.runMatchedCommand();

    expect(mockCharactersImport).toHaveBeenCalledWith(expect.objectContaining({ asUser }));
  });

  it('--force reaches charactersImport as force: true', async () => {
    process.argv = [
      'node',
      'test',
      'characters:import',
      '--env',
      'prod',
      '--dir',
      './cards',
      '--force',
    ];

    cli.parse(
      ['node', 'test', 'characters:import', '--env', 'prod', '--dir', './cards', '--force'],
      { run: false }
    );
    await cli.runMatchedCommand();

    expect(mockCharactersImport).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });
});
