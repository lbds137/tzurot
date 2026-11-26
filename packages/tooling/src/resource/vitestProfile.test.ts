import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UsageError } from '../utils/errors.js';
import { resolveVitestResourceProfile } from './vitestProfile.js';

const GIB = 1024 ** 3;
const tempDirs: string[] = [];
function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vprof-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveVitestResourceProfile', () => {
  it('reads the .env layer: RESOURCE_PROFILE=cloud in .env resolves cloud for an env with nothing set', () => {
    const dir = makeDir();
    writeFileSync(join(dir, '.env'), 'RESOURCE_PROFILE=cloud\n');
    const resolved = resolveVitestResourceProfile({
      env: {},
      rootDir: dir,
      cpus: 8,
      memTotalBytes: 64 * GIB,
    });
    expect(resolved.profile).toBe('cloud');
    expect(resolved.knobs.vitestMaxWorkers).toBe(2);
    expect(resolved.trigger).toContain('.env');
  });

  it('the process env wins over the .env layer, and an explicit knob wins over the table', () => {
    const dir = makeDir();
    writeFileSync(join(dir, '.env'), 'RESOURCE_PROFILE=cloud\n');
    const resolved = resolveVitestResourceProfile({
      env: { RESOURCE_PROFILE: 'low', VITEST_MAX_WORKERS: '1' },
      rootDir: dir,
      cpus: 8,
      memTotalBytes: 64 * GIB,
    });
    expect(resolved.profile).toBe('low');
    expect(resolved.knobs.vitestMaxWorkers).toBe(1);
  });

  it('CI in the env resolves full ahead of the auto rule', () => {
    const resolved = resolveVitestResourceProfile({
      env: { CI: 'true' },
      rootDir: makeDir(),
      cpus: 2,
      memTotalBytes: 8 * GIB,
    });
    expect(resolved.profile).toBe('full');
    expect(resolved.knobs.vitestMaxWorkers).toBe(3);
  });

  it('a LOW_RESOURCE_MODE=0 opt-out in .env reaches an unwrapped run and resolves full', () => {
    const dir = makeDir();
    writeFileSync(join(dir, '.env'), 'LOW_RESOURCE_MODE=0\n');
    const resolved = resolveVitestResourceProfile({
      env: {},
      rootDir: dir,
      cpus: 8,
      memTotalBytes: Math.round(14.45 * GIB),
    });
    expect(resolved.profile).toBe('full');
    expect(resolved.trigger).toContain('LOW_RESOURCE_MODE');
  });

  it('an invalid .env value is a UsageError once the layer is consulted', () => {
    const dir = makeDir();
    writeFileSync(join(dir, '.env'), 'RESOURCE_PROFILE=bogus\n');
    expect(() =>
      resolveVitestResourceProfile({
        env: {},
        rootDir: dir,
        cpus: 8,
        memTotalBytes: 64 * GIB,
      })
    ).toThrow(UsageError);
  });
});
