/**
 * BaseConfigResolver Unit Tests
 * Tests the cascading resolution/caching primitives shared by all concrete
 * resolvers (anonymous short-circuit, cache-key shape, cache behavior,
 * invalidation prefix precision).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseConfigResolver, type ResolutionResult } from './BaseConfigResolver.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

interface TestConfig {
  v: string;
}

class TestResolver extends BaseConfigResolver<TestConfig> {
  protected readonly resolverName = 'TestResolver';
  public resolveFreshSpy =
    vi.fn<(userId: string, contextId?: string) => Promise<ResolutionResult<TestConfig>>>();

  protected async resolveFresh(
    userId: string,
    contextId?: string
  ): Promise<ResolutionResult<TestConfig>> {
    return this.resolveFreshSpy(userId, contextId);
  }

  protected getSystemDefault(): TestConfig {
    return { v: 'system' };
  }

  // Public passthrough so the protected key helper can be asserted directly.
  public keyFor(userId: string, contextId?: string): string {
    return this.getCacheKey(userId, contextId);
  }
}

function makeResolver(): TestResolver {
  // The prisma client is never touched by these tests — BaseConfigResolver
  // stores it but resolveFresh is stubbed via resolveFreshSpy.
  const prismaStub = {} as unknown as PrismaClient;
  const resolver = new TestResolver(prismaStub);
  resolver.resolveFreshSpy.mockResolvedValue({
    config: { v: 'fresh' },
    source: 'user-default',
  });
  return resolver;
}

describe('BaseConfigResolver', () => {
  describe('anonymous short-circuit', () => {
    it('returns system default for undefined userId without calling resolveFresh', async () => {
      const resolver = makeResolver();

      const result = await resolver.resolve(undefined);

      expect(result).toEqual({ config: { v: 'system' }, source: 'system-default' });
      expect(resolver.resolveFreshSpy).not.toHaveBeenCalled();
    });

    it('returns system default for empty-string userId without calling resolveFresh', async () => {
      const resolver = makeResolver();

      const result = await resolver.resolve('');

      expect(result).toEqual({ config: { v: 'system' }, source: 'system-default' });
      expect(resolver.resolveFreshSpy).not.toHaveBeenCalled();
    });
  });

  describe('cache-key shape', () => {
    it('joins userId and contextId with a colon', () => {
      const resolver = makeResolver();
      expect(resolver.keyFor('u', 'ctx')).toBe('u:ctx');
    });

    it('uses the __default__ sentinel when contextId is undefined', () => {
      const resolver = makeResolver();
      expect(resolver.keyFor('u', undefined)).toBe('u:__default__');
    });

    it('uses the __default__ sentinel when contextId is an empty string', () => {
      const resolver = makeResolver();
      expect(resolver.keyFor('u', '')).toBe('u:__default__');
    });
  });

  describe('behavioral cache-key contract via resolve()', () => {
    it('does not share a cache entry across different contextIds for the same user', async () => {
      const resolver = makeResolver();

      await resolver.resolve('user-1', 'ctx-a');
      await resolver.resolve('user-1', 'ctx-b');

      expect(resolver.resolveFreshSpy).toHaveBeenCalledTimes(2);
      expect(resolver.resolveFreshSpy.mock.calls).toEqual([
        ['user-1', 'ctx-a'],
        ['user-1', 'ctx-b'],
      ]);
    });
  });

  describe('invalidateUserCache prefix precision', () => {
    let resolver: TestResolver;

    beforeEach(() => {
      resolver = makeResolver();
    });

    it('invalidating user "12" does not clear user "123"s cache entry, and does clear "12"s', async () => {
      // Warm both users' cache entries via the public resolve() API.
      await resolver.resolve('12');
      await resolver.resolve('123');
      expect(resolver.resolveFreshSpy).toHaveBeenCalledTimes(2);
      resolver.resolveFreshSpy.mockClear();

      resolver.invalidateUserCache('12');

      // "123" survived — a follow-up resolve must hit the cache, not resolveFresh.
      await resolver.resolve('123');
      expect(resolver.resolveFreshSpy).not.toHaveBeenCalled();

      // "12" was cleared — a follow-up resolve must re-invoke resolveFresh.
      await resolver.resolve('12');
      expect(resolver.resolveFreshSpy).toHaveBeenCalledTimes(1);
      expect(resolver.resolveFreshSpy.mock.calls).toEqual([['12', undefined]]);
    });
  });
});
