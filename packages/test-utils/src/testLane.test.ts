import { describe, expect, it } from 'vitest';
import {
  TEST_LANE_REDIS_DB,
  checkoutRootOf,
  integrationDbNameForLane,
  laneRedisUrl,
  resolveLaneRedisUrl,
  resolveTestLane,
} from './testLane.js';

describe('TEST_LANE_REDIS_DB and integrationDbNameForLane', () => {
  it('maps lanes a..e to dedicated non-zero Redis DBs 15..11', () => {
    expect(TEST_LANE_REDIS_DB).toEqual({
      a: 15,
      b: 14,
      c: 13,
      d: 12,
      e: 11,
    });
  });

  it('keeps tzurot_integration_test for lane a and suffixes _<lane>_test for b..e', () => {
    expect(integrationDbNameForLane('a')).toBe('tzurot_integration_test');
    expect(integrationDbNameForLane('b')).toBe('tzurot_integration_b_test');
    expect(integrationDbNameForLane('c')).toBe('tzurot_integration_c_test');
    expect(integrationDbNameForLane('d')).toBe('tzurot_integration_d_test');
    expect(integrationDbNameForLane('e')).toBe('tzurot_integration_e_test');
  });
});

describe('checkoutRootOf', () => {
  it('returns the parent checkout path when given an agent worktree path', () => {
    expect(checkoutRootOf('/x/tzurot-b/.claude/worktrees/agent-1')).toBe('/x/tzurot-b');
    expect(checkoutRootOf('/x/tzurot/.claude/worktrees/task-9/packages/test-utils')).toBe(
      '/x/tzurot'
    );
  });

  it('returns a regular checkout path unchanged', () => {
    expect(checkoutRootOf('/srv/u/Projects/tzurot')).toBe('/srv/u/Projects/tzurot');
    expect(checkoutRootOf('/x/tzurot-b')).toBe('/x/tzurot-b');
  });
});

describe('resolveTestLane', () => {
  it('resolves the main checkout /srv/u/Projects/tzurot to lane a / DB 15 / tzurot_integration_test', () => {
    expect(resolveTestLane({ rootDir: '/srv/u/Projects/tzurot', env: {} })).toEqual({
      lane: 'a',
      redisDb: 15,
      integrationDbName: 'tzurot_integration_test',
      source: 'path',
    });
  });

  it('resolves /x/tzurot-b to lane b / DB 14 / tzurot_integration_b_test', () => {
    expect(resolveTestLane({ rootDir: '/x/tzurot-b', env: {} })).toEqual({
      lane: 'b',
      redisDb: 14,
      integrationDbName: 'tzurot_integration_b_test',
      source: 'path',
    });
  });

  it('resolves an agent worktree under tzurot-b to lane b', () => {
    expect(resolveTestLane({ rootDir: '/x/tzurot-b/.claude/worktrees/agent-1', env: {} })).toEqual({
      lane: 'b',
      redisDb: 14,
      integrationDbName: 'tzurot_integration_b_test',
      source: 'path',
    });
  });

  it('resolves an agent worktree under tzurot-c to lane c via the worktree fold', () => {
    expect(resolveTestLane({ rootDir: '/x/tzurot-c/.claude/worktrees/task-9', env: {} })).toEqual({
      lane: 'c',
      redisDb: 13,
      integrationDbName: 'tzurot_integration_c_test',
      source: 'path',
    });
  });

  it('resolves a CI-shaped /srv/runner/work/tzurot/tzurot checkout to lane a / DB 15', () => {
    expect(resolveTestLane({ rootDir: '/srv/runner/work/tzurot/tzurot', env: {} })).toEqual({
      lane: 'a',
      redisDb: 15,
      integrationDbName: 'tzurot_integration_test',
      source: 'path',
    });
  });

  it('falls back to lane a for non-matching names such as /x/tzurot-boot-b', () => {
    expect(resolveTestLane({ rootDir: '/x/tzurot-boot-b', env: {} })).toEqual({
      lane: 'a',
      redisDb: 15,
      integrationDbName: 'tzurot_integration_test',
      source: 'path',
    });
  });

  it('lets TZUROT_TEST_LANE=c override a path of tzurot-b', () => {
    expect(
      resolveTestLane({
        rootDir: '/x/tzurot-b',
        env: { TZUROT_TEST_LANE: 'c' },
      })
    ).toEqual({
      lane: 'c',
      redisDb: 13,
      integrationDbName: 'tzurot_integration_c_test',
      source: 'env',
    });
  });

  it('throws on an invalid TZUROT_TEST_LANE value, naming the bad value and allowed set', () => {
    expect(() =>
      resolveTestLane({
        rootDir: '/x/tzurot',
        env: { TZUROT_TEST_LANE: 'z' },
      })
    ).toThrow(/Invalid TZUROT_TEST_LANE "z".*a, b, c, d, e/);
  });

  it('falls back to path resolution when TZUROT_TEST_LANE is an empty string', () => {
    expect(
      resolveTestLane({
        rootDir: '/x/tzurot-b',
        env: { TZUROT_TEST_LANE: '' },
      })
    ).toEqual({
      lane: 'b',
      redisDb: 14,
      integrationDbName: 'tzurot_integration_b_test',
      source: 'path',
    });
  });
});

describe('laneRedisUrl', () => {
  it('sets the Redis DB pathname on a bare base URL', () => {
    expect(laneRedisUrl('redis://127.0.0.1:6379', 14)).toBe('redis://127.0.0.1:6379/14');
  });

  it('replaces an existing /0 pathname with the lane Redis DB index', () => {
    expect(laneRedisUrl('redis://127.0.0.1:6379/0', 14)).toBe('redis://127.0.0.1:6379/14');
  });
});

describe('resolveLaneRedisUrl', () => {
  it('defaults undefined raw to redis://127.0.0.1:6379/<redisDb>', () => {
    expect(resolveLaneRedisUrl({ raw: undefined, redisDb: 14, env: {} })).toBe(
      'redis://127.0.0.1:6379/14'
    );
  });

  it('defaults an empty string raw to redis://127.0.0.1:6379/<redisDb>', () => {
    expect(resolveLaneRedisUrl({ raw: '', redisDb: 14, env: {} })).toBe(
      'redis://127.0.0.1:6379/14'
    );
  });

  it('defaults a whitespace-blank raw to redis://127.0.0.1:6379/<redisDb>', () => {
    expect(resolveLaneRedisUrl({ raw: '   ', redisDb: 14, env: {} })).toBe(
      'redis://127.0.0.1:6379/14'
    );
  });

  it('returns raw unchanged when env.CI is "true"', () => {
    expect(
      resolveLaneRedisUrl({
        raw: 'redis://localhost:6379',
        redisDb: 15,
        env: { CI: 'true' },
      })
    ).toBe('redis://localhost:6379');
  });

  it('rewrites a URL with no path to /<redisDb>', () => {
    expect(
      resolveLaneRedisUrl({
        raw: 'redis://127.0.0.1:6379',
        redisDb: 14,
        env: {},
      })
    ).toBe('redis://127.0.0.1:6379/14');
  });

  it('rewrites a URL with a "/" path to /<redisDb>', () => {
    expect(
      resolveLaneRedisUrl({
        raw: 'redis://127.0.0.1:6379/',
        redisDb: 14,
        env: {},
      })
    ).toBe('redis://127.0.0.1:6379/14');
  });

  it('rewrites a URL with a "/0" path to /<redisDb>', () => {
    expect(
      resolveLaneRedisUrl({
        raw: 'redis://127.0.0.1:6379/0',
        redisDb: 14,
        env: {},
      })
    ).toBe('redis://127.0.0.1:6379/14');
  });

  it('keeps an explicit non-zero DB path such as "/5" unchanged', () => {
    expect(
      resolveLaneRedisUrl({
        raw: 'redis://127.0.0.1:6379/5',
        redisDb: 14,
        env: {},
      })
    ).toBe('redis://127.0.0.1:6379/5');
  });

  it('preserves credentials and custom port when rewriting to the lane DB', () => {
    expect(
      resolveLaneRedisUrl({
        raw: 'redis://testuser:testpass@redis.example.test:6380/0',
        redisDb: 13,
        env: {},
      })
    ).toBe('redis://testuser:testpass@redis.example.test:6380/13');
  });
});
