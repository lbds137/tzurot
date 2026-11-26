import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { UsageError } from '../utils/errors.js';
import { recordPreDotenvProfileEnv, resetPreDotenvProfileEnv } from './preDotenvEnv.js';
import { resolveLiveProfileSpawnEnv, resolveProfileSpawnEnv } from './spawnEnv.js';

const GIB = 1024 ** 3;

describe('resolveProfileSpawnEnv', () => {
  it('layers the low profile additions over the injected env without mutating it', () => {
    const env: Record<string, string> = { LOW_RESOURCE_MODE: '1' };
    const { resolved, env: spawnEnv } = resolveProfileSpawnEnv({
      env,
      cpus: 8,
      memTotalBytes: Math.round(14.45 * GIB),
    });
    expect(resolved.profile).toBe('low');
    expect(spawnEnv.RESOURCE_PROFILE).toBe('low');
    expect(spawnEnv.TURBO_CONCURRENCY).toBe('1');
    expect(spawnEnv.VITEST_MAX_WORKERS).toBe('1');
    expect(spawnEnv.NODE_OPTIONS).toBe('--max-old-space-size=3072');
    expect(env).toEqual({ LOW_RESOURCE_MODE: '1' });
  });

  it('passes caller-supplied envFileValues through to the resolver', () => {
    const { resolved, env } = resolveProfileSpawnEnv({
      env: {},
      envFileValues: { RESOURCE_PROFILE: 'cloud' },
      cpus: 8,
      memTotalBytes: 64 * GIB,
    });
    expect(resolved.profile).toBe('cloud');
    expect(env.TURBO_CONCURRENCY).toBe('2');
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it('lets explicit knob env win over the table', () => {
    const { env } = resolveProfileSpawnEnv({
      env: { LOW_RESOURCE_MODE: '1', TURBO_CONCURRENCY: '4' },
      cpus: 8,
      memTotalBytes: Math.round(14.45 * GIB),
    });
    expect(env.TURBO_CONCURRENCY).toBe('4');
  });

  it('propagates the resolver UsageError for an invalid env value', () => {
    expect(() =>
      resolveProfileSpawnEnv({
        env: { RESOURCE_PROFILE: 'nope' },
        cpus: 8,
        memTotalBytes: 64 * GIB,
      })
    ).toThrow(UsageError);
  });
});

describe('resolveLiveProfileSpawnEnv', () => {
  const tempDirs: string[] = [];
  function checkoutWithEnvFile(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'lrm-spawn-'));
    tempDirs.push(dir);
    writeFileSync(join(dir, '.env'), content);
    return dir;
  }

  afterEach(() => {
    resetPreDotenvProfileEnv();
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('keeps a shell LOW_RESOURCE_MODE above a .env RESOURCE_PROFILE that dotenv copied into process.env', () => {
    const cwd = checkoutWithEnvFile('RESOURCE_PROFILE=cloud\n');
    // The shell held only LOW_RESOURCE_MODE; dotenv then added RESOURCE_PROFILE.
    recordPreDotenvProfileEnv({ LOW_RESOURCE_MODE: '1' });
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { resolved, env } = resolveLiveProfileSpawnEnv(cwd, {
      LOW_RESOURCE_MODE: '1',
      RESOURCE_PROFILE: 'cloud',
      KEEP_ME: 'yes',
    });
    expect(resolved.profile).toBe('low');
    expect(resolved.trigger).toBe('LOW_RESOURCE_MODE=1');
    expect(env.RESOURCE_PROFILE).toBe('low');
    expect(env.KEEP_ME).toBe('yes');
    expect(stderr.mock.calls[0]?.[0]).toContain('LOW_RESOURCE_MODE=1');
  });

  it('does not let a dotenv-added VITEST_MAX_WORKERS beat the profile the .env chose', () => {
    const cwd = checkoutWithEnvFile('LOW_RESOURCE_MODE=1\n');
    // The shell held no knob; dotenv copied VITEST_MAX_WORKERS=2 into process.env.
    recordPreDotenvProfileEnv({});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { resolved, env } = resolveLiveProfileSpawnEnv(cwd, {
      LOW_RESOURCE_MODE: '1',
      VITEST_MAX_WORKERS: '2',
    });
    expect(resolved.profile).toBe('low');
    expect(env.VITEST_MAX_WORKERS).toBe('1');
  });

  it('labels a profile that only .env carries with the .env source', () => {
    const cwd = checkoutWithEnvFile('RESOURCE_PROFILE=cloud\n');
    recordPreDotenvProfileEnv({});
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { resolved } = resolveLiveProfileSpawnEnv(cwd, { RESOURCE_PROFILE: 'cloud' });
    expect(resolved.profile).toBe('cloud');
    expect(resolved.trigger).toContain('.env');
    expect(stderr.mock.calls[0]?.[0]).toContain('.env');
  });

  it('drops a dotenv-only TURBO_CONCURRENCY when the profile emits none', () => {
    const cwd = checkoutWithEnvFile('RESOURCE_PROFILE=full\n');
    // The shell held RESOURCE_PROFILE=full and no knob; dotenv then added TURBO_CONCURRENCY=8.
    recordPreDotenvProfileEnv({ RESOURCE_PROFILE: 'full' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { resolved, env } = resolveLiveProfileSpawnEnv(cwd, {
      RESOURCE_PROFILE: 'full',
      TURBO_CONCURRENCY: '8',
      KEEP_ME: 'yes',
    });
    expect(resolved.profile).toBe('full');
    expect(env.TURBO_CONCURRENCY).toBeUndefined();
    expect('TURBO_CONCURRENCY' in env).toBe(false);
    expect(env.KEEP_ME).toBe('yes');
  });

  it('throws UsageError with the message on an invalid value instead of exiting', () => {
    const cwd = checkoutWithEnvFile('');
    recordPreDotenvProfileEnv({ RESOURCE_PROFILE: 'nope' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit');
    expect(() => resolveLiveProfileSpawnEnv(cwd, { RESOURCE_PROFILE: 'nope' })).toThrow(UsageError);
    expect(() => resolveLiveProfileSpawnEnv(cwd, { RESOURCE_PROFILE: 'nope' })).toThrow(/nope/);
    expect(exit).not.toHaveBeenCalled();
  });
});
