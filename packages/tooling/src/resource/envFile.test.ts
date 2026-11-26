import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readEnvFileValues } from './envFile.js';

// Pass-through spy: every real git call still runs, so the fallback tests keep
// their behaviour while the no-spawn test can count calls.
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const tempDirs: string[] = [];
function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lrm-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('readEnvFileValues', () => {
  it('reads only the two profile keys from <cwd>/.env', () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, '.env'),
      'RESOURCE_PROFILE=cloud\nSECRET_BEARER_TOKEN=do-not-leak\nLOW_RESOURCE_MODE=1\n'
    );
    const values = readEnvFileValues(dir);
    expect(values).toEqual({ RESOURCE_PROFILE: 'cloud', LOW_RESOURCE_MODE: '1' });
    expect(Object.keys(values).sort()).toEqual(['LOW_RESOURCE_MODE', 'RESOURCE_PROFILE']);
  });

  it('keeps the last matching line and strips quotes, comments and CR', () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, '.env'),
      'RESOURCE_PROFILE="cloud"\r\nRESOURCE_PROFILE=low\r\nLOW_RESOURCE_MODE=\'1\' # deck\r\n'
    );
    expect(readEnvFileValues(dir)).toEqual({ RESOURCE_PROFILE: 'low', LOW_RESOURCE_MODE: '1' });
  });

  it('strips every CR like the shell reader, including mid-value and repeated ones', () => {
    const dir = makeDir();
    writeFileSync(join(dir, '.env'), 'RESOURCE_PROFILE=lo\rw\r\nLOW_RESOURCE_MODE=1\r\r\n');
    expect(readEnvFileValues(dir)).toEqual({ RESOURCE_PROFILE: 'low', LOW_RESOURCE_MODE: '1' });
  });

  it('keeps a value with no space before # and reads whitespace-only as unset', () => {
    const dir = makeDir();
    writeFileSync(join(dir, '.env'), 'RESOURCE_PROFILE=low#nospace\nLOW_RESOURCE_MODE=   \n');
    expect(readEnvFileValues(dir)).toEqual({ RESOURCE_PROFILE: 'low#nospace' });
  });

  it('falls back per key to the main checkout .env', () => {
    const repo = makeDir();
    const sub = join(repo, 'pkg');
    mkdirSync(sub);
    execFileSync('git', ['init', '--quiet', repo], { stdio: 'ignore' });
    writeFileSync(join(repo, '.env'), 'RESOURCE_PROFILE=full\nLOW_RESOURCE_MODE=1\n');
    expect(readEnvFileValues(sub)).toEqual({ RESOURCE_PROFILE: 'full', LOW_RESOURCE_MODE: '1' });
    writeFileSync(join(sub, '.env'), 'RESOURCE_PROFILE=low\n');
    expect(readEnvFileValues(sub)).toEqual({ RESOURCE_PROFILE: 'low', LOW_RESOURCE_MODE: '1' });
  });

  it('falls back per key when the local .env exists but carries the keys absent or empty', () => {
    const repo = makeDir();
    const sub = join(repo, 'pkg');
    mkdirSync(sub);
    execFileSync('git', ['init', '--quiet', repo], { stdio: 'ignore' });
    writeFileSync(join(repo, '.env'), 'RESOURCE_PROFILE=cloud\nLOW_RESOURCE_MODE=1\n');
    writeFileSync(join(sub, '.env'), 'OTHER_KEY=untouched\nLOW_RESOURCE_MODE=\n');
    expect(readEnvFileValues(sub)).toEqual({ RESOURCE_PROFILE: 'cloud', LOW_RESOURCE_MODE: '1' });
  });

  it('does not spawn git when the local .env carries both keys', () => {
    const dir = makeDir();
    writeFileSync(join(dir, '.env'), 'RESOURCE_PROFILE=cloud\nLOW_RESOURCE_MODE=1\n');
    vi.mocked(execFileSync).mockClear();
    expect(readEnvFileValues(dir)).toEqual({ RESOURCE_PROFILE: 'cloud', LOW_RESOURCE_MODE: '1' });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('spawns git exactly once when both keys fall through to the main checkout', () => {
    const repo = makeDir();
    execFileSync('git', ['init', '--quiet', repo], { stdio: 'ignore' });
    writeFileSync(join(repo, '.env'), 'RESOURCE_PROFILE=full\nLOW_RESOURCE_MODE=1\n');
    const sub = join(repo, 'pkg');
    mkdirSync(sub);
    vi.mocked(execFileSync).mockClear();
    expect(readEnvFileValues(sub)).toEqual({ RESOURCE_PROFILE: 'full', LOW_RESOURCE_MODE: '1' });
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });

  it('returns empty outside a repo with no .env', () => {
    const dir = makeDir();
    expect(readEnvFileValues(dir)).toEqual({});
  });
});
