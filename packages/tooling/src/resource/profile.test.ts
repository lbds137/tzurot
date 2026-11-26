import { describe, expect, it } from 'vitest';

import { UsageError } from '../utils/errors.js';
import {
  AUTO_CLOUD_MAX_CPUS,
  AUTO_LOW_MAX_MEMORY_BYTES,
  PROFILE_KNOBS,
  buildProfileEnv,
  formatProfileLine,
  resolveResourceProfile,
  type ProfileInput,
} from './profile.js';

const GIB = 1024 ** 3;
const DECK = { cpus: 8, memTotalBytes: Math.round(14.45 * GIB) };
const input = (over: Partial<ProfileInput> = {}): ProfileInput => ({
  env: {},
  ...DECK,
  ...over,
});

describe('auto rule', () => {
  it('resolves low on an 8-cpu 14-GiB Deck with the throttled knobs', () => {
    const resolved = resolveResourceProfile(input());
    expect(resolved.profile).toBe('low');
    expect(resolved.trigger).toBe('auto: 14.5 GiB total memory');
    expect(resolved.knobs).toEqual({ turboConcurrency: 1, vitestMaxWorkers: 1, nodeHeapMb: 3072 });
  });

  it('resolves low on a 4-cpu 8-GiB machine: memory is checked before cpus', () => {
    const resolved = resolveResourceProfile(input({ cpus: 4, memTotalBytes: 8 * GIB }));
    expect(resolved.profile).toBe('low');
    expect(resolved.trigger).toBe('auto: 8.0 GiB total memory');
  });

  it('resolves cloud on a 4-cpu 32-GiB machine', () => {
    const resolved = resolveResourceProfile(input({ cpus: 4, memTotalBytes: 32 * GIB }));
    expect(resolved.profile).toBe('cloud');
    expect(resolved.trigger).toBe('auto: 4 cpus');
  });

  it('resolves cloud at the cpu ceiling', () => {
    const resolved = resolveResourceProfile(input({ cpus: 4, memTotalBytes: 64 * GIB }));
    expect(resolved.profile).toBe('cloud');
    expect(resolved.trigger).toBe('auto: 4 cpus');
    expect(resolved.knobs).toEqual({ turboConcurrency: 2, vitestMaxWorkers: 2 });
    expect(resolved.knobs.nodeHeapMb).toBeUndefined();
  });

  it('resolves full on a big machine', () => {
    const resolved = resolveResourceProfile(input({ cpus: 8, memTotalBytes: 32 * GIB }));
    expect(resolved.profile).toBe('full');
    expect(resolved.knobs).toEqual({ vitestMaxWorkers: 3 });
    expect(resolved.trigger).toBe('auto: 8 cpus, 32.0 GiB total memory');
  });

  it('CI wins over a low machine and over the cpu count', () => {
    const resolved = resolveResourceProfile(input({ env: { CI: 'true' }, cpus: 4 }));
    expect(resolved.profile).toBe('full');
    expect(resolved.trigger).toBe('CI');
    expect(resolved.knobs).toEqual({ vitestMaxWorkers: 3 });
    expect(resolved.knobs.turboConcurrency).toBeUndefined();
  });

  it.each(['false', '0', ''])('treats CI=%s as off and falls through to the machine rule', ci => {
    const resolved = resolveResourceProfile(
      input({ env: { CI: ci }, cpus: 4, memTotalBytes: 64 * GIB })
    );
    expect(resolved.profile).toBe('cloud');
  });

  it('stays low at the memory ceiling and flips above it', () => {
    const at = resolveResourceProfile(input({ memTotalBytes: AUTO_LOW_MAX_MEMORY_BYTES }));
    const above = resolveResourceProfile(input({ memTotalBytes: AUTO_LOW_MAX_MEMORY_BYTES + 1 }));
    expect(at.profile).toBe('low');
    expect(above.profile).toBe('full');
  });

  it('stays cloud at the cpu ceiling and flips above it', () => {
    const at = resolveResourceProfile(
      input({ cpus: AUTO_CLOUD_MAX_CPUS, memTotalBytes: 64 * GIB })
    );
    const above = resolveResourceProfile(
      input({ cpus: AUTO_CLOUD_MAX_CPUS + 1, memTotalBytes: 64 * GIB })
    );
    expect(at.profile).toBe('cloud');
    expect(above.profile).toBe('full');
  });
});

describe('explicit layers', () => {
  it('RESOURCE_PROFILE is case-insensitive and names itself in the trigger', () => {
    const resolved = resolveResourceProfile(input({ env: { RESOURCE_PROFILE: 'Cloud' } }));
    expect(resolved.profile).toBe('cloud');
    expect(resolved.trigger).toBe('RESOURCE_PROFILE=Cloud');
    expect(resolved.knobs).toEqual({ turboConcurrency: 2, vitestMaxWorkers: 2 });
  });

  it('auto and empty continue to lower layers', () => {
    const auto = resolveResourceProfile(input({ env: { RESOURCE_PROFILE: 'auto' } }));
    expect(auto.profile).toBe('low');
    expect(auto.trigger).toContain('auto:');
    const empty = resolveResourceProfile(input({ env: { RESOURCE_PROFILE: '' } }));
    expect(empty.profile).toBe('low');
  });

  it('rejects an unknown value naming the valid ones', () => {
    const attempt = () => resolveResourceProfile(input({ env: { RESOURCE_PROFILE: 'tiny' } }));
    expect(attempt).toThrow(UsageError);
    expect(attempt).toThrow(/low, cloud, full/);
  });

  it.each(['1', 'true', 'yes', 'on'])('LOW_RESOURCE_MODE=%s forces low', value => {
    const resolved = resolveResourceProfile({
      env: { LOW_RESOURCE_MODE: value },
      cpus: 32,
      memTotalBytes: 64 * GIB,
    });
    expect(resolved.profile).toBe('low');
    expect(resolved.trigger).toBe(`LOW_RESOURCE_MODE=${value}`);
  });

  it.each(['0', 'false', 'no', 'off'])(
    'LOW_RESOURCE_MODE=%s forces full even where auto would pick cloud',
    value => {
      const resolved = resolveResourceProfile(
        input({ env: { LOW_RESOURCE_MODE: value }, cpus: 2 })
      );
      expect(resolved.profile).toBe('full');
      expect(resolved.trigger).toBe(`LOW_RESOURCE_MODE=${value}`);
    }
  );

  it('rejects an unknown LOW_RESOURCE_MODE value', () => {
    expect(() => resolveResourceProfile(input({ env: { LOW_RESOURCE_MODE: '2' } }))).toThrow(
      UsageError
    );
    expect(() => resolveResourceProfile(input({ env: { LOW_RESOURCE_MODE: '2' } }))).toThrow(
      /1, true, yes, on/
    );
  });

  it('the .env layer applies with its own trigger and loses to the env layer', () => {
    const envWins = resolveResourceProfile(
      input({ env: { LOW_RESOURCE_MODE: '1' }, envFileValues: { RESOURCE_PROFILE: 'cloud' } })
    );
    expect(envWins.profile).toBe('low');
    expect(envWins.trigger).toBe('LOW_RESOURCE_MODE=1');

    const fileProfile = resolveResourceProfile(
      input({ envFileValues: { RESOURCE_PROFILE: 'cloud' } })
    );
    expect(fileProfile.profile).toBe('cloud');
    expect(fileProfile.trigger).toBe('.env: RESOURCE_PROFILE=cloud');

    const fileMode = resolveResourceProfile(input({ envFileValues: { LOW_RESOURCE_MODE: '1' } }));
    expect(fileMode.profile).toBe('low');
    expect(fileMode.trigger).toBe('.env: LOW_RESOURCE_MODE=1');
  });

  it('validates .env values too', () => {
    expect(() =>
      resolveResourceProfile(input({ envFileValues: { RESOURCE_PROFILE: 'meh' } }))
    ).toThrow(UsageError);
    expect(() =>
      resolveResourceProfile(input({ envFileValues: { LOW_RESOURCE_MODE: 'maybe' } }))
    ).toThrow(UsageError);
  });
});

describe('knob overrides', () => {
  it('explicit knob env wins over the table', () => {
    const resolved = resolveResourceProfile(
      input({ env: { TURBO_CONCURRENCY: '4', VITEST_MAX_WORKERS: '2' } })
    );
    expect(resolved.knobs).toEqual({ turboConcurrency: 4, vitestMaxWorkers: 2, nodeHeapMb: 3072 });
  });

  it.each(['0', '-1', 'abc', '2.5'])('rejects non-positive-integer knob value %s', value => {
    expect(() => resolveResourceProfile(input({ env: { TURBO_CONCURRENCY: value } }))).toThrow(
      UsageError
    );
    expect(() => resolveResourceProfile(input({ env: { VITEST_MAX_WORKERS: value } }))).toThrow(
      UsageError
    );
  });

  it('an existing heap cap in NODE_OPTIONS suppresses the heap knob', () => {
    const capped = resolveResourceProfile(
      input({ env: { NODE_OPTIONS: '--require hooks.cjs --max-old-space-size=4096' } })
    );
    expect(capped.knobs.nodeHeapMb).toBeUndefined();
    const uncapped = resolveResourceProfile(
      input({ env: { NODE_OPTIONS: '--require hooks.cjs' } })
    );
    expect(uncapped.knobs.nodeHeapMb).toBe(3072);
    const bare = resolveResourceProfile(input({ env: { NODE_OPTIONS: '--max-old-space-size' } }));
    expect(bare.knobs.nodeHeapMb).toBeUndefined();
  });

  it('treats the underscore spelling of the heap flag as a cap too', () => {
    const underscored = resolveResourceProfile(
      input({ env: { NODE_OPTIONS: '--max_old_space_size=8192' } })
    );
    expect(underscored.knobs.nodeHeapMb).toBeUndefined();
    const additions = buildProfileEnv(underscored, { NODE_OPTIONS: '--max_old_space_size=8192' });
    expect(additions.NODE_OPTIONS).toBeUndefined();
  });
});

describe('buildProfileEnv', () => {
  it('low exports all four additions', () => {
    const resolved = resolveResourceProfile(input());
    expect(buildProfileEnv(resolved, {})).toEqual({
      RESOURCE_PROFILE: 'low',
      VITEST_MAX_WORKERS: '1',
      TURBO_CONCURRENCY: '1',
      NODE_OPTIONS: '--max-old-space-size=3072',
    });
  });

  it('cloud exports three additions and full exports two', () => {
    const cloud = resolveResourceProfile(input({ cpus: 4, memTotalBytes: 64 * GIB }));
    expect(buildProfileEnv(cloud, {})).toEqual({
      RESOURCE_PROFILE: 'cloud',
      VITEST_MAX_WORKERS: '2',
      TURBO_CONCURRENCY: '2',
    });
    const full = resolveResourceProfile(input({ env: { CI: '1' }, memTotalBytes: 64 * GIB }));
    expect(buildProfileEnv(full, {})).toEqual({
      RESOURCE_PROFILE: 'full',
      VITEST_MAX_WORKERS: '3',
    });
  });

  it('appends the heap cap to an existing NODE_OPTIONS', () => {
    const resolved = resolveResourceProfile(input({ env: { NODE_OPTIONS: '--no-warnings' } }));
    expect(buildProfileEnv(resolved, { NODE_OPTIONS: '--no-warnings' })).toEqual({
      RESOURCE_PROFILE: 'low',
      VITEST_MAX_WORKERS: '1',
      TURBO_CONCURRENCY: '1',
      NODE_OPTIONS: '--no-warnings --max-old-space-size=3072',
    });
  });
});

describe('formatProfileLine', () => {
  it('renders the deck example and the CI case', () => {
    expect(formatProfileLine(resolveResourceProfile(input()))).toBe(
      'resource profile: low (auto: 14.5 GiB total memory) - turbo 1, vitest 1, heap 3072 MB'
    );
    expect(
      formatProfileLine(
        resolveResourceProfile(input({ env: { CI: '1' }, memTotalBytes: 32 * GIB }))
      )
    ).toBe('resource profile: full (CI) - turbo default, vitest 3');
  });
});

it('the knob table holds the documented values', () => {
  expect(PROFILE_KNOBS).toEqual({
    low: { turboConcurrency: 1, vitestMaxWorkers: 1, nodeHeapMb: 3072 },
    cloud: { turboConcurrency: 2, vitestMaxWorkers: 2 },
    full: { vitestMaxWorkers: 3 },
  });
});
