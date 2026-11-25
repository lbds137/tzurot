import { describe, expect, it } from 'vitest';
import {
  TEST_LANE_REDIS_DB,
  checkoutRootOf,
  findWorkspaceRoot,
  integrationDbNameForLane,
  laneRedisUrl,
  redisDbForUrl,
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
    expect(resolveLaneRedisUrl({ raw: undefined, redisDb: 14 })).toBe('redis://127.0.0.1:6379/14');
  });

  it('defaults an empty string raw to redis://127.0.0.1:6379/<redisDb>', () => {
    expect(resolveLaneRedisUrl({ raw: '', redisDb: 14 })).toBe('redis://127.0.0.1:6379/14');
  });

  it('defaults a whitespace-blank raw to redis://127.0.0.1:6379/<redisDb>', () => {
    expect(resolveLaneRedisUrl({ raw: '   ', redisDb: 14 })).toBe('redis://127.0.0.1:6379/14');
  });

  it("maps CI's throwaway redis://localhost:6379 to lane a's DB 15 like a local URL", () => {
    expect(resolveLaneRedisUrl({ raw: 'redis://localhost:6379', redisDb: 15 })).toBe(
      'redis://localhost:6379/15'
    );
  });

  it('throws on an unparsable URL without echoing the value', () => {
    const secret = 'not a url hunter2';
    expect(() => resolveLaneRedisUrl({ raw: secret, redisDb: 14 })).toThrow(
      /REDIS_URL is not a valid URL/
    );
    expect(() => resolveLaneRedisUrl({ raw: secret, redisDb: 14 })).not.toThrow(/hunter2/);
  });

  it('rewrites a URL with no path to /<redisDb>', () => {
    expect(
      resolveLaneRedisUrl({
        raw: 'redis://127.0.0.1:6379',
        redisDb: 14,
      })
    ).toBe('redis://127.0.0.1:6379/14');
  });

  it('rewrites a URL with a "/" path to /<redisDb>', () => {
    expect(
      resolveLaneRedisUrl({
        raw: 'redis://127.0.0.1:6379/',
        redisDb: 14,
      })
    ).toBe('redis://127.0.0.1:6379/14');
  });

  it('rewrites a URL with a "/0" path to /<redisDb>', () => {
    expect(
      resolveLaneRedisUrl({
        raw: 'redis://127.0.0.1:6379/0',
        redisDb: 14,
      })
    ).toBe('redis://127.0.0.1:6379/14');
  });

  it('keeps an explicit non-zero DB path such as "/5" unchanged', () => {
    expect(
      resolveLaneRedisUrl({
        raw: 'redis://127.0.0.1:6379/5',
        redisDb: 14,
      })
    ).toBe('redis://127.0.0.1:6379/5');
  });

  it('accepts an explicit DB equal to its own lane DB', () => {
    expect(resolveLaneRedisUrl({ raw: 'redis://127.0.0.1:6379/14', redisDb: 14 })).toBe(
      'redis://127.0.0.1:6379/14'
    );
  });

  it("throws on another lane's DB without echoing the URL", () => {
    const raw = 'redis://user:hunter2@127.0.0.1:6379/15';
    expect(() => resolveLaneRedisUrl({ raw, redisDb: 14 })).toThrow(
      /Redis DB 15, which belongs to test lane a; this checkout is lane-DB 14/
    );
    expect(() => resolveLaneRedisUrl({ raw, redisDb: 14 })).not.toThrow(/hunter2/);
  });

  it('preserves credentials and custom port when rewriting to the lane DB', () => {
    expect(
      resolveLaneRedisUrl({
        raw: 'redis://testuser:testpass@redis.example.test:6380/0',
        redisDb: 13,
      })
    ).toBe('redis://testuser:testpass@redis.example.test:6380/13');
  });
});

describe('redisDbForUrl', () => {
  it.each([
    ['redis://127.0.0.1:6379/5', 5],
    ['redis://127.0.0.1:6379/14', 14],
  ])('returns the explicit non-zero DB of %s', (raw, expected) => {
    expect(redisDbForUrl(raw, 14)).toBe(expected);
  });

  it("throws on another lane's DB without echoing the URL", () => {
    const raw = 'redis://user:hunter2@127.0.0.1:6379/15';
    expect(() => redisDbForUrl(raw, 14)).toThrow(/Redis DB 15, which belongs to test lane a/);
    expect(() => redisDbForUrl(raw, 14)).not.toThrow(/hunter2/);
  });

  it.each([
    [undefined],
    [''],
    ['   '],
    ['redis://127.0.0.1:6379'],
    ['redis://127.0.0.1:6379/'],
    ['redis://127.0.0.1:6379/0'],
    ['redis://127.0.0.1:6379/abc'],
  ])('falls back to the lane DB for %s', raw => {
    expect(redisDbForUrl(raw, 14)).toBe(14);
  });

  it('throws on an unparsable URL without echoing the value', () => {
    const secret = 'not a url hunter2';
    expect(() => redisDbForUrl(secret, 14)).toThrow(/REDIS_URL is not a valid URL/);
    expect(() => redisDbForUrl(secret, 14)).not.toThrow(/hunter2/);
  });
});

describe('resolveLaneRedisUrl and redisDbForUrl agree', () => {
  it.each([
    [undefined],
    [''],
    ['   '],
    ['redis://h:6379'],
    ['redis://h:6379/'],
    ['redis://h:6379/0'],
    ['redis://h:6379/5'],
    ['redis://h:6379/14'],
    ['redis://localhost:6379'],
    ['redis://user:pass@h:6380'],
    ['redis://user:pass@h:6380/0'],
    ['redis://user:pass@h:6380/5'],
  ])('selects the same DB for %s', raw => {
    expect(new URL(resolveLaneRedisUrl({ raw, redisDb: 14 })).pathname).toBe(
      `/${redisDbForUrl(raw, 14)}`
    );
  });

  it("throws for both functions on another lane's DB (/15 at lane DB 14)", () => {
    const raw = 'redis://h:6379/15';
    expect(() => resolveLaneRedisUrl({ raw, redisDb: 14 })).toThrow(/belongs to test lane a/);
    expect(() => redisDbForUrl(raw, 14)).toThrow(/belongs to test lane a/);
  });
});

describe('findWorkspaceRoot', () => {
  const marker = '/pnpm-workspace.yaml';

  it('returns startDir when it holds the workspace file', () => {
    expect(findWorkspaceRoot('/a/b/tzurot-c', p => p === `/a/b/tzurot-c${marker}`)).toBe(
      '/a/b/tzurot-c'
    );
  });

  it('returns the nearest ancestor holding the workspace file', () => {
    expect(findWorkspaceRoot('/a/b/tzurot-c/packages/x', p => p === `/a/b/tzurot-c${marker}`)).toBe(
      '/a/b/tzurot-c'
    );
  });

  it('returns startDir when no ancestor holds the workspace file', () => {
    expect(findWorkspaceRoot('/x/tzurot-c/sub', () => false)).toBe('/x/tzurot-c/sub');
  });
});
