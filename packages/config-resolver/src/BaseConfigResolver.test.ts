/**
 * Tests for BaseConfigResolver.
 *
 * Exercises the cascade waterfall + cache lifecycle through a minimal
 * concrete subclass. The subclass-specific Prisma queries and field
 * extraction are tested in `LlmConfigResolver.test.ts` (and will be in
 * `TtsConfigResolver.test.ts`); this file owns the base behaviors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BaseConfigResolver,
  type BaseConfigResolverOptions,
  type ConfigOverrideEntry,
  type UserWithDefault,
} from './BaseConfigResolver.js';
vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});
// ===== Minimal test fixtures =================================================

/** Tiny "personality" shape: just a name field carrying the default config. */
interface FakePersonality {
  defaultName: string;
}

/** Override row from a tier — same name as personality field for merge tests. */
interface FakeOverride {
  name: string;
  /** The "configName" callers see (separate from the merged field name). */
  displayName: string;
}

/** Resolved shape: just the resolved name. */
interface FakeResolved {
  resolvedName: string;
}

class FakeResolver extends BaseConfigResolver<FakePersonality, FakeOverride, FakeResolved> {
  // Test hooks override these via instance assignment in beforeEach
  public mockUserWithDefault: () => Promise<UserWithDefault<FakeOverride> | null> = async () =>
    null;
  public mockPerPersonalityOverride: () => Promise<ConfigOverrideEntry<FakeOverride> | null> =
    async () => null;

  constructor(options?: BaseConfigResolverOptions) {
    super('FakeResolver', options);
  }

  protected async findUserWithDefault(): Promise<UserWithDefault<FakeOverride> | null> {
    return this.mockUserWithDefault();
  }

  protected async findPerPersonalityOverride(): Promise<ConfigOverrideEntry<FakeOverride> | null> {
    return this.mockPerPersonalityOverride();
  }

  protected async extractFromPersonality(personality: FakePersonality): Promise<FakeResolved> {
    return { resolvedName: personality.defaultName };
  }

  protected mergeWithPersonality(
    personality: FakePersonality,
    override: FakeOverride,
    _tier: 'user-personality' | 'user-default'
  ): FakeResolved {
    return { resolvedName: override.name || personality.defaultName };
  }
}

const FAKE_PERSONALITY: FakePersonality = { defaultName: 'persona-default' };

// ===== Tests =================================================================

describe('BaseConfigResolver', () => {
  let resolver: FakeResolver;

  beforeEach(() => {
    vi.useFakeTimers();
    resolver = new FakeResolver({
      cacheTtlMs: 60_000,
      enableCleanup: false,
      now: () => Date.now(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('resolveConfig waterfall', () => {
    it('returns personality default when userId is undefined', async () => {
      const result = await resolver.resolveConfig(undefined, 'p-1', FAKE_PERSONALITY);
      expect(result.source).toBe('personality');
      expect(result.config.resolvedName).toBe('persona-default');
      expect(result.configName).toBeUndefined();
    });

    it('returns personality default when userId is empty string', async () => {
      const result = await resolver.resolveConfig('', 'p-1', FAKE_PERSONALITY);
      expect(result.source).toBe('personality');
    });

    it('returns personality default when user not found in DB', async () => {
      resolver.mockUserWithDefault = async () => null;
      const result = await resolver.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);
      expect(result.source).toBe('personality');
    });

    it('returns per-personality override when present (priority 1)', async () => {
      resolver.mockUserWithDefault = async () => ({
        internalId: 'internal-x',
        defaultOverride: {
          override: { name: 'global-default', displayName: 'Global' },
          name: 'Global',
        },
      });
      resolver.mockPerPersonalityOverride = async () => ({
        override: { name: 'per-personality', displayName: 'Per-Personality' },
        name: 'Per-Personality',
      });

      const result = await resolver.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);

      expect(result.source).toBe('user-personality');
      expect(result.config.resolvedName).toBe('per-personality');
      expect(result.configName).toBe('Per-Personality');
    });

    it('returns user-default when no per-personality override (priority 2)', async () => {
      resolver.mockUserWithDefault = async () => ({
        internalId: 'internal-x',
        defaultOverride: {
          override: { name: 'user-default', displayName: 'User-Default' },
          name: 'User-Default',
        },
      });
      resolver.mockPerPersonalityOverride = async () => null;

      const result = await resolver.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);

      expect(result.source).toBe('user-default');
      expect(result.config.resolvedName).toBe('user-default');
      expect(result.configName).toBe('User-Default');
    });

    it('falls back to personality default when user has no overrides', async () => {
      resolver.mockUserWithDefault = async () => ({
        internalId: 'internal-x',
        defaultOverride: null,
      });
      resolver.mockPerPersonalityOverride = async () => null;

      const result = await resolver.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);

      expect(result.source).toBe('personality');
      expect(result.config.resolvedName).toBe('persona-default');
    });

    it('falls back to personality default on a thrown error', async () => {
      resolver.mockUserWithDefault = async () => {
        throw new Error('DB exploded');
      };

      const result = await resolver.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);

      expect(result.source).toBe('personality');
      expect(result.config.resolvedName).toBe('persona-default');
    });
  });

  describe('caching', () => {
    it('caches successful resolutions', async () => {
      const userMock = vi.fn().mockResolvedValue({
        internalId: 'internal-x',
        defaultOverride: null,
      });
      resolver.mockUserWithDefault = userMock;
      resolver.mockPerPersonalityOverride = async () => null;

      await resolver.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);
      await resolver.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);

      expect(userMock).toHaveBeenCalledTimes(1);
    });

    it('uses different cache keys for different personalities', async () => {
      const userMock = vi.fn().mockResolvedValue({
        internalId: 'internal-x',
        defaultOverride: null,
      });
      resolver.mockUserWithDefault = userMock;
      resolver.mockPerPersonalityOverride = async () => null;

      await resolver.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);
      await resolver.resolveConfig('user-x', 'p-2', FAKE_PERSONALITY);

      expect(userMock).toHaveBeenCalledTimes(2);
    });

    it('respects cache TTL — re-queries after expiry', async () => {
      const userMock = vi.fn().mockResolvedValue({
        internalId: 'internal-x',
        defaultOverride: null,
      });
      resolver.mockUserWithDefault = userMock;
      resolver.mockPerPersonalityOverride = async () => null;

      await resolver.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);
      vi.advanceTimersByTime(70_000); // Past the 60s TTL
      await resolver.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);

      expect(userMock).toHaveBeenCalledTimes(2);
    });

    it('does not cache thrown-error fallbacks (so retries can recover)', async () => {
      const userMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce({ internalId: 'internal-x', defaultOverride: null });
      resolver.mockUserWithDefault = userMock;
      resolver.mockPerPersonalityOverride = async () => null;

      const first = await resolver.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);
      expect(first.source).toBe('personality'); // fallback from error

      const second = await resolver.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);
      expect(second.source).toBe('personality'); // legitimate personality fallback
      expect(userMock).toHaveBeenCalledTimes(2); // did NOT cache the error
    });
  });

  describe('cache invalidation', () => {
    it('invalidateUserCache removes entries for one user only', async () => {
      const userMockA = vi.fn().mockResolvedValue({ internalId: 'a', defaultOverride: null });
      const userMockB = vi.fn().mockResolvedValue({ internalId: 'b', defaultOverride: null });
      let activeMock = userMockA;
      resolver.mockUserWithDefault = () => activeMock();
      resolver.mockPerPersonalityOverride = async () => null;

      await resolver.resolveConfig('user-a', 'p-1', FAKE_PERSONALITY);
      activeMock = userMockB;
      await resolver.resolveConfig('user-b', 'p-1', FAKE_PERSONALITY);

      resolver.invalidateUserCache('user-a');

      // user-a invalidated → re-query
      activeMock = userMockA;
      await resolver.resolveConfig('user-a', 'p-1', FAKE_PERSONALITY);
      expect(userMockA).toHaveBeenCalledTimes(2);

      // user-b still cached
      activeMock = userMockB;
      await resolver.resolveConfig('user-b', 'p-1', FAKE_PERSONALITY);
      expect(userMockB).toHaveBeenCalledTimes(1);
    });

    it('clearCache removes all entries', async () => {
      const userMock = vi.fn().mockResolvedValue({ internalId: 'x', defaultOverride: null });
      resolver.mockUserWithDefault = userMock;
      resolver.mockPerPersonalityOverride = async () => null;

      await resolver.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);
      resolver.clearCache();
      await resolver.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);

      expect(userMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('stopCleanup (backwards-compat no-op)', () => {
    it('does not throw and does not break subsequent operations', async () => {
      resolver.mockUserWithDefault = async () => null;
      resolver.stopCleanup();
      const result = await resolver.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);
      expect(result.source).toBe('personality');
    });
  });

  describe('constructor options', () => {
    it('constructs without an options argument and still resolves', async () => {
      // Every options access in the constructor must tolerate `undefined` —
      // production call sites construct resolvers bare (no injected clock).
      const bare = new FakeResolver();
      bare.mockUserWithDefault = async () => null;

      const result = await bare.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);

      expect(result).toEqual({
        config: { resolvedName: 'persona-default' },
        source: 'personality',
      });
    });
  });

  describe('user-not-found caching', () => {
    it('caches the user-not-found resolution (single DB lookup for repeat calls)', async () => {
      // The user-null branch and the thrown-error fallback produce the SAME
      // result shape — what distinguishes them is caching: user-not-found is
      // a definitive answer and must cache, while errors must not (so retries
      // can recover). Asserting the lookup count pins the branch apart.
      const lookup = vi.fn().mockResolvedValue(null);
      resolver.mockUserWithDefault = lookup;

      const first = await resolver.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);
      const second = await resolver.resolveConfig('user-x', 'p-1', FAKE_PERSONALITY);

      expect(first.source).toBe('personality');
      expect(second).toEqual(first);
      expect(lookup).toHaveBeenCalledTimes(1);
    });
  });
});
