import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SttResolver } from './SttResolver.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

// Shared logger instance so tests can assert on (absence of) warnings — the
// resolver's logger is created once in the constructor.
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});
// Minimal Prisma double — the resolver only consumes `prisma.user.findFirst`,
// so a typed double is sufficient and avoids dragging the live Prisma client
// into every test.

interface MockUserRow {
  defaultSttProviderId: string | null;
  defaultTtsConfig: { provider: string } | null;
}

const mockFindFirst = vi.fn<(args: unknown) => Promise<MockUserRow | null>>();

const mockPrisma = {
  user: { findFirst: (args: unknown) => mockFindFirst(args) },
} as unknown as PrismaClient;

beforeEach(() => {
  mockFindFirst.mockReset();
});

function userRow(opts: Partial<MockUserRow> = {}): MockUserRow {
  return {
    defaultSttProviderId: opts.defaultSttProviderId ?? null,
    defaultTtsConfig: opts.defaultTtsConfig ?? null,
  };
}

describe('SttResolver', () => {
  describe('resolveProvider — 3-layer cascade', () => {
    it('Layer 3 (hardcoded) when userId undefined — no DB lookup', async () => {
      const resolver = new SttResolver(mockPrisma);

      const result = await resolver.resolveProvider(undefined);

      expect(result).toEqual({ provider: 'voice-engine', source: 'hardcoded' });
      expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it('Layer 3 (hardcoded) when user row missing', async () => {
      mockFindFirst.mockResolvedValue(null);
      const resolver = new SttResolver(mockPrisma);

      const result = await resolver.resolveProvider('discord-1');

      expect(result).toEqual({ provider: 'voice-engine', source: 'hardcoded' });
    });

    it('Layer 1 (user-default) wins over tts-derived', async () => {
      mockFindFirst.mockResolvedValue(
        userRow({
          defaultSttProviderId: 'voice-engine',
          defaultTtsConfig: { provider: 'mistral' }, // would be derivable
        })
      );
      const resolver = new SttResolver(mockPrisma);

      const result = await resolver.resolveProvider('discord-1');

      expect(result).toEqual({ provider: 'voice-engine', source: 'user-default' });
    });

    it('Layer 2 (tts-derived) when user has no STT override and TTS is mistral', async () => {
      mockFindFirst.mockResolvedValue(userRow({ defaultTtsConfig: { provider: 'mistral' } }));
      const resolver = new SttResolver(mockPrisma);

      const result = await resolver.resolveProvider('discord-1');

      expect(result).toEqual({ provider: 'mistral', source: 'tts-derived' });
    });

    it('Layer 2 (tts-derived) when user has no STT override and TTS is elevenlabs', async () => {
      mockFindFirst.mockResolvedValue(userRow({ defaultTtsConfig: { provider: 'elevenlabs' } }));
      const resolver = new SttResolver(mockPrisma);

      const result = await resolver.resolveProvider('discord-1');

      expect(result).toEqual({ provider: 'elevenlabs', source: 'tts-derived' });
    });

    it('Layer 2 SKIPPED when default TTS is self-hosted (different STT engine)', async () => {
      mockFindFirst.mockResolvedValue(userRow({ defaultTtsConfig: { provider: 'self-hosted' } }));
      const resolver = new SttResolver(mockPrisma);

      const result = await resolver.resolveProvider('discord-1');

      expect(result).toEqual({ provider: 'voice-engine', source: 'hardcoded' });
    });

    it('Layer 3 (hardcoded) when user has no STT override AND no default TTS', async () => {
      mockFindFirst.mockResolvedValue(userRow());
      const resolver = new SttResolver(mockPrisma);

      const result = await resolver.resolveProvider('discord-1');

      expect(result).toEqual({ provider: 'voice-engine', source: 'hardcoded' });
    });
  });

  describe('resolveProvider — defensive narrowing', () => {
    it('skips Layer 1 with an unknown provider string and falls through', async () => {
      mockFindFirst.mockResolvedValue(
        userRow({
          defaultSttProviderId: 'whisper', // not a known SttProvider
          defaultTtsConfig: { provider: 'mistral' },
        })
      );
      const resolver = new SttResolver(mockPrisma);

      const result = await resolver.resolveProvider('discord-1');

      // 'whisper' fails narrowing → Layer 2 (tts-derived: mistral) wins.
      expect(result).toEqual({ provider: 'mistral', source: 'tts-derived' });
    });
  });

  describe('resolveProvider — error handling', () => {
    it('falls back to voice-engine when DB query throws', async () => {
      mockFindFirst.mockRejectedValue(new Error('connection refused'));
      const resolver = new SttResolver(mockPrisma);

      const result = await resolver.resolveProvider('discord-1');

      expect(result).toEqual({ provider: 'voice-engine', source: 'hardcoded' });
    });
  });

  describe('cache behavior', () => {
    it('caches the second call for the same userId', async () => {
      mockFindFirst.mockResolvedValue(userRow({ defaultSttProviderId: 'mistral' }));
      const resolver = new SttResolver(mockPrisma);

      await resolver.resolveProvider('discord-1');
      await resolver.resolveProvider('discord-1');

      expect(mockFindFirst).toHaveBeenCalledTimes(1);
    });

    it('different userIds are cached independently', async () => {
      mockFindFirst.mockResolvedValue(userRow({ defaultSttProviderId: 'mistral' }));
      const resolver = new SttResolver(mockPrisma);

      await resolver.resolveProvider('discord-1');
      await resolver.resolveProvider('discord-2');

      expect(mockFindFirst).toHaveBeenCalledTimes(2);
    });

    it('invalidateUserCache evicts the entry for that user', async () => {
      mockFindFirst.mockResolvedValue(userRow({ defaultSttProviderId: 'mistral' }));
      const resolver = new SttResolver(mockPrisma);

      await resolver.resolveProvider('discord-1');
      resolver.invalidateUserCache('discord-1');
      await resolver.resolveProvider('discord-1');

      expect(mockFindFirst).toHaveBeenCalledTimes(2);
    });

    it('does NOT cache failures (transient errors should retry next call)', async () => {
      mockFindFirst.mockRejectedValueOnce(new Error('blip'));
      mockFindFirst.mockResolvedValueOnce(userRow({ defaultSttProviderId: 'mistral' }));
      const resolver = new SttResolver(mockPrisma);

      const first = await resolver.resolveProvider('discord-1');
      expect(first).toEqual({ provider: 'voice-engine', source: 'hardcoded' });

      const second = await resolver.resolveProvider('discord-1');
      expect(second).toEqual({ provider: 'mistral', source: 'user-default' });
    });
  });

  describe('cascade guards', () => {
    it('Layer 3 (hardcoded) for an empty-string userId — no DB lookup', async () => {
      const resolver = new SttResolver(mockPrisma);

      const result = await resolver.resolveProvider('');

      expect(result).toEqual({ provider: 'voice-engine', source: 'hardcoded' });
      expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it('does NOT derive STT from a self-hosted TTS default (BYOK-only layer)', async () => {
      // Self-hosted TTS (Pocket TTS) does not imply self-hosted STT — the
      // tts-derived layer exists to reuse a BYOK key, and 'self-hosted' has
      // no key to reuse. Must fall through to the hardcoded layer, not
      // mislabel the source as tts-derived.
      mockFindFirst.mockResolvedValue(userRow({ defaultTtsConfig: { provider: 'self-hosted' } }));
      const resolver = new SttResolver(mockPrisma);

      const result = await resolver.resolveProvider('discord-1');

      expect(result).toEqual({ provider: 'voice-engine', source: 'hardcoded' });
    });

    it('does not warn when the STT override is simply unset', async () => {
      // The "unknown provider string" warning is for corrupt DB values only —
      // a NULL override is the normal state and must stay silent.
      mockLogger.warn.mockClear();
      mockFindFirst.mockResolvedValue(userRow());
      const resolver = new SttResolver(mockPrisma);

      await resolver.resolveProvider('discord-1');

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('caching behavior', () => {
    it('caches the user-not-found resolution (single lookup for repeat calls)', async () => {
      // User-not-found is definitive and must cache; only thrown errors skip
      // the cache (so transient DB blips retry).
      mockFindFirst.mockResolvedValue(null);
      const resolver = new SttResolver(mockPrisma);

      await resolver.resolveProvider('discord-1');
      await resolver.resolveProvider('discord-1');

      expect(mockFindFirst).toHaveBeenCalledTimes(1);
    });

    it('applies a custom cacheTtlMs — entries expire on the custom window', async () => {
      vi.useFakeTimers();
      try {
        mockFindFirst.mockResolvedValue(userRow({ defaultSttProviderId: 'voice-engine' }));
        const resolver = new SttResolver(mockPrisma, { cacheTtlMs: 1_000, now: () => Date.now() });

        await resolver.resolveProvider('discord-1');
        vi.advanceTimersByTime(1_500); // past the CUSTOM ttl
        await resolver.resolveProvider('discord-1');

        expect(mockFindFirst).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('query shape (the Prisma seam)', () => {
    it('selects exactly the STT override + the TTS-provider join', async () => {
      mockFindFirst.mockResolvedValue(null);
      const resolver = new SttResolver(mockPrisma);

      await resolver.resolveProvider('discord-1');

      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { discordId: 'discord-1' },
        select: {
          defaultSttProviderId: true,
          defaultTtsConfig: { select: { provider: true } },
        },
      });
    });
  });
});
