import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkEnvExample, diffEnvKeys, parseEnvKeys } from './check-env-example.js';

const SENTINEL = 'SENTINEL_VALUE_MUST_NOT_PRINT';

describe('parseEnvKeys', () => {
  it('collects active keys and ignores comments and blank lines', () => {
    const keys = parseEnvKeys('# header\n\nALPHA=1\n# BETA=2\n   # GAMMA=3\nDELTA=\n');
    expect([...keys].sort()).toEqual(['ALPHA', 'DELTA']);
  });

  it('parses an export prefix and an inline comment after the value as the key', () => {
    const keys = parseEnvKeys('export EXPORTED_KEY=value\nINLINE_KEY=value  # a note\n');
    expect([...keys].sort()).toEqual(['EXPORTED_KEY', 'INLINE_KEY']);
  });

  it('tolerates whitespace around the key and the equals sign', () => {
    expect([...parseEnvKeys('  SPACED_KEY = value\n')]).toEqual(['SPACED_KEY']);
  });

  it('does not read a continuation line of a multi-line quoted value as a key', () => {
    const contents = `PEM_KEY="-----BEGIN-----\nABCDEF0123=\n-----END-----"\nAFTER_KEY=1\n`;
    expect([...parseEnvKeys(contents)].sort()).toEqual(['AFTER_KEY', 'PEM_KEY']);
  });

  it('treats a quoted value closed on its own line as complete', () => {
    const contents = `QUOTED_KEY="a \\" b"\nNEXT_KEY=1\n`;
    expect([...parseEnvKeys(contents)].sort()).toEqual(['NEXT_KEY', 'QUOTED_KEY']);
  });

  it('handles CRLF line endings', () => {
    expect([...parseEnvKeys('ONE=1\r\nTWO=2\r\n')].sort()).toEqual(['ONE', 'TWO']);
  });
});

describe('diffEnvKeys', () => {
  it('reports each direction separately, sorted', () => {
    const drift = diffEnvKeys(new Set(['SHARED', 'Z_ENV', 'A_ENV']), new Set(['SHARED', 'EX']));
    expect(drift).toEqual({ envOnly: ['A_ENV', 'Z_ENV'], exampleOnly: ['EX'] });
  });
});

describe('checkEnvExample (entry point)', () => {
  let tmp: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let savedExitCode: typeof process.exitCode;

  function writeFixture(files: { env?: string; example?: string }): void {
    if (files.env !== undefined) writeFileSync(join(tmp, '.env'), files.env);
    if (files.example !== undefined) writeFileSync(join(tmp, '.env.example'), files.example);
  }

  function allOutput(): string {
    return [...logSpy.mock.calls, ...errorSpy.mock.calls]
      .map((call: unknown[]) => call.join(' '))
      .join('\n');
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'guard-env-example-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = savedExitCode;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('passes when both files declare the same active keys', () => {
    writeFixture({ env: 'A=real\nB=real\n', example: 'A=placeholder\nB=\n' });
    checkEnvExample();
    expect(process.exitCode).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('declare the same 2 keys'));
  });

  it('env-only key fails', () => {
    writeFixture({ env: 'SHARED=1\nENV_ONLY_KEY=1\n', example: 'SHARED=\n' });
    checkEnvExample();
    expect(process.exitCode).toBe(1);
    expect(allOutput()).toContain('in .env but not .env.example: ENV_ONLY_KEY');
  });

  it('example-only key fails', () => {
    writeFixture({ env: 'SHARED=1\n', example: 'SHARED=\nEXAMPLE_ONLY_KEY=\n' });
    checkEnvExample();
    expect(process.exitCode).toBe(1);
    expect(allOutput()).toContain('in .env.example but not .env: EXAMPLE_ONLY_KEY');
  });

  it('passes when a commented optional key exists in only one file', () => {
    // The commented row is the ONLY difference between the two fixtures.
    writeFixture({ env: 'SHARED=1\n', example: 'SHARED=\n# OPTIONAL_KEY=\n' });
    checkEnvExample();
    expect(process.exitCode).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('skips cleanly when .env is absent', () => {
    writeFixture({ example: 'SHARED=\n' });
    checkEnvExample();
    expect(process.exitCode).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('skipped'));
  });

  it('fails when .env.example is absent', () => {
    writeFixture({ env: 'SHARED=1\n' });
    checkEnvExample();
    expect(process.exitCode).toBe(1);
    expect(allOutput()).toContain('.env.example not found');
  });

  it('never prints a value, from either file', () => {
    writeFixture({
      env: `SHARED=${SENTINEL}\nLEAKY_ENV_KEY=${SENTINEL}\n`,
      example: `SHARED=${SENTINEL}\nLEAKY_EXAMPLE_KEY="${SENTINEL}"  # ${SENTINEL}\n`,
    });
    checkEnvExample();
    expect(process.exitCode).toBe(1);
    const output = allOutput();
    expect(output).toContain('LEAKY_ENV_KEY');
    expect(output).toContain('LEAKY_EXAMPLE_KEY');
    expect(output).not.toContain(SENTINEL);
  });
});
