import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SttResolver } from './SttResolver.js';
import type { PrismaClient } from './prisma.js';
import type { TtsConfigResolver, LoadedTtsPersonality } from './TtsConfigResolver.js';
import type { ResolvedTtsConfig } from './tts/TtsProvider.js';

// Minimal Prisma + TtsConfigResolver doubles. Real PrismaClient and
// TtsConfigResolver have far richer surface; the resolver only consumes
// `prisma.user.findFirst` and `ttsResolver.resolveConfig`, so a typed
// double is sufficient and avoids dragging the live Prisma client into
// every test.

interface MockUserRow {
  defaultProvider: string | null;
  defaultSttProviderId: string | null;
  personalityConfigs: Array<{ sttProviderId: string | null }>;
}

const mockFindFirst = vi.fn<(args: unknown) => Promise<MockUserRow | null>>();
const mockTtsResolve = vi.fn<
  (
    userId: string | undefined,
    personalityId: string,
    personality: LoadedTtsPersonality
  ) => Promise<{
    config: ResolvedTtsConfig;
    source: string;
  }>
>();

const mockPrisma = {
  user: { findFirst: (args: unknown) => mockFindFirst(args) },
} as unknown as PrismaClient;

const mockTtsResolver = {
  resolveConfig: (
    userId: string | undefined,
    personalityId: string,
    personality: LoadedTtsPersonality
  ) => mockTtsResolve(userId, personalityId, personality),
} as unknown as TtsConfigResolver;

const personality: LoadedTtsPersonality = {
  id: 'personality-uuid',
  ttsConfigId: null,
} as unknown as LoadedTtsPersonality;

beforeEach(() => {
  mockFindFirst.mockReset();
  mockTtsResolve.mockReset();
});

function selfHostedTts(): { config: ResolvedTtsConfig; source: string } {
  return {
    config: { provider: 'self-hosted' } as unknown as ResolvedTtsConfig,
    source: 'hardcoded',
  };
}

function mistralTts(): { config: ResolvedTtsConfig; source: string } {
  return {
    config: { provider: 'mistral' } as unknown as ResolvedTtsConfig,
    source: 'user-default',
  };
}

function elevenlabsTts(): { config: ResolvedTtsConfig; source: string } {
  return {
    config: { provider: 'elevenlabs' } as unknown as ResolvedTtsConfig,
    source: 'user-default',
  };
}

function noopUserRow(): MockUserRow {
  return {
    defaultProvider: null,
    defaultSttProviderId: null,
    personalityConfigs: [],
  };
}

describe('SttResolver', () => {
  describe('resolveProvider — cascade layers', () => {
    it('Layer 5 (hardcoded) when userId undefined — no DB lookup', async () => {
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      const result = await resolver.resolveProvider(undefined, 'p-1', personality);

      expect(result).toEqual({ provider: 'voice-engine', source: 'hardcoded' });
      expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it('Layer 5 (hardcoded) when user row missing', async () => {
      mockFindFirst.mockResolvedValue(null);
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      const result = await resolver.resolveProvider('discord-1', 'p-1', personality);

      expect(result).toEqual({ provider: 'voice-engine', source: 'hardcoded' });
      expect(mockTtsResolve).not.toHaveBeenCalled();
    });

    it('Layer 1 (user-personality) wins over all lower layers', async () => {
      mockFindFirst.mockResolvedValue({
        defaultProvider: 'mistral',
        defaultSttProviderId: 'mistral',
        personalityConfigs: [{ sttProviderId: 'elevenlabs' }],
      });
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      const result = await resolver.resolveProvider('discord-1', 'p-1', personality);

      expect(result).toEqual({ provider: 'elevenlabs', source: 'user-personality' });
      expect(mockTtsResolve).not.toHaveBeenCalled();
    });

    it('Layer 2 (user-default) when no per-personality override', async () => {
      mockFindFirst.mockResolvedValue({
        defaultProvider: 'mistral',
        defaultSttProviderId: 'voice-engine',
        personalityConfigs: [],
      });
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      const result = await resolver.resolveProvider('discord-1', 'p-1', personality);

      expect(result).toEqual({ provider: 'voice-engine', source: 'user-default' });
      expect(mockTtsResolve).not.toHaveBeenCalled();
    });

    it('Layer 3 (tts-derived) when TTS resolves to mistral', async () => {
      mockFindFirst.mockResolvedValue(noopUserRow());
      mockTtsResolve.mockResolvedValue(mistralTts());
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      const result = await resolver.resolveProvider('discord-1', 'p-1', personality);

      expect(result).toEqual({ provider: 'mistral', source: 'tts-derived' });
    });

    it('Layer 3 (tts-derived) when TTS resolves to elevenlabs', async () => {
      mockFindFirst.mockResolvedValue(noopUserRow());
      mockTtsResolve.mockResolvedValue(elevenlabsTts());
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      const result = await resolver.resolveProvider('discord-1', 'p-1', personality);

      expect(result).toEqual({ provider: 'elevenlabs', source: 'tts-derived' });
    });

    it('Layer 3 SKIPPED when TTS resolves to self-hosted (different engines)', async () => {
      mockFindFirst.mockResolvedValue({
        defaultProvider: 'voice-engine',
        defaultSttProviderId: null,
        personalityConfigs: [],
      });
      mockTtsResolve.mockResolvedValue(selfHostedTts());
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      const result = await resolver.resolveProvider('discord-1', 'p-1', personality);

      // Falls through Layer 3, lands on Layer 4 (admin-default = voice-engine).
      expect(result).toEqual({ provider: 'voice-engine', source: 'admin-default' });
    });

    it('Layer 4 (admin-default) when TTS not derivable and no user override', async () => {
      mockFindFirst.mockResolvedValue({
        defaultProvider: 'mistral',
        defaultSttProviderId: null,
        personalityConfigs: [],
      });
      mockTtsResolve.mockResolvedValue(selfHostedTts());
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      const result = await resolver.resolveProvider('discord-1', 'p-1', personality);

      expect(result).toEqual({ provider: 'mistral', source: 'admin-default' });
    });

    it('Layer 5 (hardcoded) when all layers exhausted', async () => {
      mockFindFirst.mockResolvedValue(noopUserRow());
      mockTtsResolve.mockResolvedValue(selfHostedTts());
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      const result = await resolver.resolveProvider('discord-1', 'p-1', personality);

      expect(result).toEqual({ provider: 'voice-engine', source: 'hardcoded' });
    });
  });

  describe('resolveProvider — defensive narrowing', () => {
    it('skips a layer with an unknown provider string and falls through', async () => {
      mockFindFirst.mockResolvedValue({
        defaultProvider: null,
        defaultSttProviderId: 'whisper', // not a known SttProvider
        personalityConfigs: [],
      });
      mockTtsResolve.mockResolvedValue(selfHostedTts());
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      const result = await resolver.resolveProvider('discord-1', 'p-1', personality);

      // Layer 2 was 'whisper' (unknown), skip → Layer 3 (self-hosted, skip)
      // → Layer 4 (admin-default null) → Layer 5 (hardcoded).
      expect(result).toEqual({ provider: 'voice-engine', source: 'hardcoded' });
    });
  });

  describe('resolveProvider — error handling', () => {
    it('falls back to voice-engine when DB query throws', async () => {
      mockFindFirst.mockRejectedValue(new Error('connection refused'));
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      const result = await resolver.resolveProvider('discord-1', 'p-1', personality);

      expect(result).toEqual({ provider: 'voice-engine', source: 'hardcoded' });
    });

    it('falls back to voice-engine when TtsConfigResolver throws', async () => {
      mockFindFirst.mockResolvedValue(noopUserRow());
      mockTtsResolve.mockRejectedValue(new Error('tts boom'));
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      const result = await resolver.resolveProvider('discord-1', 'p-1', personality);

      expect(result).toEqual({ provider: 'voice-engine', source: 'hardcoded' });
    });
  });

  describe('cache behavior', () => {
    it('caches the second call for the same (userId, personalityId)', async () => {
      mockFindFirst.mockResolvedValue({
        defaultProvider: null,
        defaultSttProviderId: 'mistral',
        personalityConfigs: [],
      });
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      await resolver.resolveProvider('discord-1', 'p-1', personality);
      await resolver.resolveProvider('discord-1', 'p-1', personality);

      expect(mockFindFirst).toHaveBeenCalledTimes(1);
    });

    it('different personality keys are cached independently', async () => {
      mockFindFirst.mockResolvedValue({
        defaultProvider: null,
        defaultSttProviderId: 'mistral',
        personalityConfigs: [],
      });
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      await resolver.resolveProvider('discord-1', 'p-1', personality);
      await resolver.resolveProvider('discord-1', 'p-2', personality);

      expect(mockFindFirst).toHaveBeenCalledTimes(2);
    });

    it('invalidateUserCache evicts all entries for that user', async () => {
      mockFindFirst.mockResolvedValue({
        defaultProvider: null,
        defaultSttProviderId: 'mistral',
        personalityConfigs: [],
      });
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      await resolver.resolveProvider('discord-1', 'p-1', personality);
      resolver.invalidateUserCache('discord-1');
      await resolver.resolveProvider('discord-1', 'p-1', personality);

      expect(mockFindFirst).toHaveBeenCalledTimes(2);
    });

    it('does NOT cache failures (transient errors should retry next call)', async () => {
      mockFindFirst.mockRejectedValueOnce(new Error('blip'));
      mockFindFirst.mockResolvedValueOnce({
        defaultProvider: null,
        defaultSttProviderId: 'mistral',
        personalityConfigs: [],
      });
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      const first = await resolver.resolveProvider('discord-1', 'p-1', personality);
      expect(first).toEqual({ provider: 'voice-engine', source: 'hardcoded' });

      const second = await resolver.resolveProvider('discord-1', 'p-1', personality);
      expect(second).toEqual({ provider: 'mistral', source: 'user-default' });
    });
  });

  describe('resolveProviderWithTtsHint — pure JIT-footer comparison variant', () => {
    it('uses the hint instead of calling TtsConfigResolver for Layer 3', async () => {
      mockFindFirst.mockResolvedValue(noopUserRow());
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      const withMistral = await resolver.resolveProviderWithTtsHint('discord-1', 'p-1', 'mistral');
      const withSelfHosted = await resolver.resolveProviderWithTtsHint(
        'discord-1',
        'p-1',
        'self-hosted'
      );

      expect(withMistral).toEqual({ provider: 'mistral', source: 'tts-derived' });
      expect(withSelfHosted).toEqual({ provider: 'voice-engine', source: 'hardcoded' });
      expect(mockTtsResolve).not.toHaveBeenCalled();
    });

    it('returns hardcoded fallback when userId undefined (no DB lookup)', async () => {
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      const result = await resolver.resolveProviderWithTtsHint(undefined, 'p-1', 'mistral');

      expect(result).toEqual({ provider: 'voice-engine', source: 'hardcoded' });
      expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it('still respects Layer 1 + Layer 2 even when TTS hint provided', async () => {
      mockFindFirst.mockResolvedValue({
        defaultProvider: null,
        defaultSttProviderId: null,
        personalityConfigs: [{ sttProviderId: 'voice-engine' }],
      });
      const resolver = new SttResolver(mockPrisma, mockTtsResolver);

      const result = await resolver.resolveProviderWithTtsHint('discord-1', 'p-1', 'mistral');

      expect(result).toEqual({ provider: 'voice-engine', source: 'user-personality' });
    });
  });
});
