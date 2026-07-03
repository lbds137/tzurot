import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TtsConfigResolver } from './TtsConfigResolver.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

// Hoisted logger spies so tests can assert severity (the WARN→ERROR upgrade
// for personality-default lookup failures is a behavioral contract worth pinning).
const { mockLoggerError, mockLoggerWarn } = vi.hoisted(() => ({
  mockLoggerError: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));
vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: mockLoggerWarn,
      error: mockLoggerError,
    }),
  };
});

interface MockPrisma {
  user: { findFirst: ReturnType<typeof vi.fn> };
  userPersonalityConfig: { findFirst: ReturnType<typeof vi.fn> };
  personalityDefaultTtsConfig: { findUnique: ReturnType<typeof vi.fn> };
  /** Free-default resolution reads the AdminSettings pointer (singleton). */
  adminSettings: { findUnique: ReturnType<typeof vi.fn> };
}

function createMockPrisma(): MockPrisma {
  return {
    user: { findFirst: vi.fn() },
    userPersonalityConfig: { findFirst: vi.fn() },
    personalityDefaultTtsConfig: { findUnique: vi.fn() },
    adminSettings: { findUnique: vi.fn() },
  };
}

const FAKE_PERSONALITY = { id: 'p-uuid-123' };

describe('TtsConfigResolver', () => {
  let mockPrisma: MockPrisma;
  let resolver: TtsConfigResolver;

  beforeEach(() => {
    vi.useFakeTimers();
    mockPrisma = createMockPrisma();
    resolver = new TtsConfigResolver(mockPrisma as unknown as PrismaClient, {
      cacheTtlMs: 60_000,
      enableCleanup: false,
      now: () => Date.now(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('resolveConfig cascade', () => {
    it('returns hardcoded fallback when no userId and no personality default and no free default', async () => {
      mockPrisma.personalityDefaultTtsConfig.findUnique.mockResolvedValue(null);
      mockPrisma.adminSettings.findUnique.mockResolvedValue(null);

      const result = await resolver.resolveConfig(undefined, 'p-uuid-123', FAKE_PERSONALITY);

      expect(result.config.provider).toBe('self-hosted');
      expect(result.config.modelId).toBeNull();
      // Outer source now matches the inner config.source (carry-over from
      // PR #958: ConfigResolutionSource union extended + getExtractSource hook)
      expect(result.source).toBe('hardcoded');
      expect(result.config.source).toBe('hardcoded');
    });

    it('returns user-personality override (priority 1)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-x',
        defaultTtsConfigId: null,
        defaultTtsConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue({
        ttsConfig: {
          name: 'user-pers-override',
          provider: 'mistral',
          modelId: 'voxtral-mini-tts-2603',
          advancedParameters: null,
          isGlobal: false,
          isDefault: false,
          isFreeDefault: false,
        },
      });

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

      expect(result.source).toBe('user-personality');
      expect(result.config.provider).toBe('mistral');
      expect(result.config.modelId).toBe('voxtral-mini-tts-2603');
      expect(result.configName).toBe('user-pers-override');
    });

    it('user-personality result has matching inner config.source (regression — PR #958)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-x',
        defaultTtsConfigId: null,
        defaultTtsConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue({
        ttsConfig: {
          name: 'cfg',
          provider: 'mistral',
          modelId: 'voxtral-mini-tts-2603',
          advancedParameters: null,
          isGlobal: false,
          isDefault: false,
          isFreeDefault: false,
        },
      });

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

      expect(result.source).toBe('user-personality');
      // Inner config.source must match outer source — the fix for the
      // mergeWithPersonality bug claude-review flagged on PR #958.
      expect(result.config.source).toBe('user-personality');
    });

    it('user-default result has matching inner config.source (regression — PR #958)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-x',
        defaultTtsConfigId: 'cfg-id',
        defaultTtsConfig: {
          name: 'cfg',
          provider: 'elevenlabs',
          modelId: 'eleven_v3',
          advancedParameters: null,
          isGlobal: false,
          isDefault: true,
          isFreeDefault: false,
        },
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

      expect(result.source).toBe('user-default');
      // Pre-fix this was incorrectly 'user-personality' — mergeWithPersonality
      // hardcoded the inner source. Fix passes the tier as a parameter.
      expect(result.config.source).toBe('user-default');
    });

    it('returns user-default when no per-personality override (priority 2)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-x',
        defaultTtsConfigId: 'cfg-id',
        defaultTtsConfig: {
          name: 'tts-byok-mine',
          provider: 'elevenlabs',
          modelId: 'eleven_v3',
          advancedParameters: null,
          isGlobal: false,
          isDefault: true,
          isFreeDefault: false,
        },
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

      expect(result.source).toBe('user-default');
      expect(result.config.provider).toBe('elevenlabs');
      expect(result.config.modelId).toBe('eleven_v3');
      expect(result.configName).toBe('tts-byok-mine');
    });

    it('falls through to PersonalityDefaultTtsConfig (tier 3) when user has no overrides', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-x',
        defaultTtsConfigId: null,
        defaultTtsConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);
      mockPrisma.personalityDefaultTtsConfig.findUnique.mockResolvedValue({
        ttsConfig: {
          name: 'persona-default',
          provider: 'mistral',
          modelId: 'voxtral-mini-tts-2603',
          advancedParameters: null,
          isGlobal: false,
          isDefault: false,
          isFreeDefault: false,
        },
      });

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

      // PersonalityDefaultTtsConfig produces inner source 'personality',
      // which getExtractSource leaves alone — outer source matches.
      expect(result.source).toBe('personality');
      expect(result.config.source).toBe('personality');
      expect(result.config.provider).toBe('mistral');
      expect(result.config.modelId).toBe('voxtral-mini-tts-2603');
    });

    it('logs at ERROR severity when PersonalityDefaultTtsConfig lookup throws (not WARN)', async () => {
      // The user (bot owner) configured a personality TTS default and we
      // can't load it — this is a misconfiguration, not graceful
      // degradation. ERROR severity ensures it surfaces in dashboards
      // rather than getting filtered with routine WARNs. The resolver
      // still falls through to free-default for correct runtime behavior.
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-x',
        defaultTtsConfigId: null,
        defaultTtsConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);
      mockPrisma.personalityDefaultTtsConfig.findUnique.mockRejectedValue(
        new Error('connection refused')
      );
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        freeDefaultTtsConfig: {
          name: 'kyutai-self-hosted',
          provider: 'self-hosted',
          modelId: null,
          advancedParameters: null,
          isGlobal: true,
        },
      });

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

      // Still falls through to free-default — no behavior regression
      expect(result.source).toBe('free-default');

      // ERROR was called with structured fields (not WARN)
      const errorCall = mockLoggerError.mock.calls.find(call =>
        String(call[1]).includes('Failed to load PersonalityDefaultTtsConfig')
      );
      expect(errorCall).toBeDefined();
      expect((errorCall![0] as Record<string, unknown>).personalityId).toBe('p-uuid-123');
      // No WARN call for this specific failure shape
      const warnCall = mockLoggerWarn.mock.calls.find(call =>
        String(call[1]).includes('Failed to load PersonalityDefaultTtsConfig')
      );
      expect(warnCall).toBeUndefined();
    });

    it('falls through to system free default (tier 4) when no PersonalityDefaultTtsConfig', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-x',
        defaultTtsConfigId: null,
        defaultTtsConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);
      mockPrisma.personalityDefaultTtsConfig.findUnique.mockResolvedValue(null);
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        freeDefaultTtsConfig: {
          name: 'kyutai-self-hosted',
          provider: 'self-hosted',
          modelId: null,
          advancedParameters: null,
          isGlobal: true,
        },
      });

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

      // free-default tier surfaces in the outer source field.
      expect(result.source).toBe('free-default');
      expect(result.config.source).toBe('free-default');
      expect(result.config.provider).toBe('self-hosted');
      expect(result.config.modelId).toBeNull();
    });

    it('falls through to hardcoded fallback (tier 5) when no DB row at any tier', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-x',
        defaultTtsConfigId: null,
        defaultTtsConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);
      mockPrisma.personalityDefaultTtsConfig.findUnique.mockResolvedValue(null);
      mockPrisma.adminSettings.findUnique.mockResolvedValue(null);

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

      expect(result.source).toBe('hardcoded');
      expect(result.config.source).toBe('hardcoded');
      expect(result.config.provider).toBe('self-hosted');
      expect(result.config.modelId).toBeNull();
      expect(result.config.advancedParameters).toEqual({});
    });
  });

  describe('getFreeDefaultConfig', () => {
    it('returns null when no isFreeDefault row exists', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue(null);
      const result = await resolver.getFreeDefaultConfig();
      expect(result).toBeNull();
    });

    it('returns mapped config when an isFreeDefault row exists', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        freeDefaultTtsConfig: {
          name: 'kyutai-self-hosted',
          provider: 'self-hosted',
          modelId: null,
          advancedParameters: null,
          isGlobal: true,
        },
      });

      const result = await resolver.getFreeDefaultConfig();

      expect(result).not.toBeNull();
      expect(result?.provider).toBe('self-hosted');
      expect(result?.source).toBe('free-default');
      expect(result?.configName).toBe('kyutai-self-hosted');
    });

    it('caches the free-default result', async () => {
      const firstCall = mockPrisma.adminSettings.findUnique.mockResolvedValue({
        freeDefaultTtsConfig: {
          name: 'kyutai-self-hosted',
          provider: 'self-hosted',
          modelId: null,
          advancedParameters: null,
          isGlobal: true,
        },
      });

      await resolver.getFreeDefaultConfig();
      await resolver.getFreeDefaultConfig();

      expect(firstCall).toHaveBeenCalledTimes(1); // second call hit cache
    });
  });

  describe('query shapes (the Prisma seam)', () => {
    it('selects the user row with the default-TTS join flags', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.personalityDefaultTtsConfig.findUnique.mockResolvedValue(null);
      mockPrisma.adminSettings.findUnique.mockResolvedValue(null);

      await resolver.resolveConfig('discord-1', 'p-uuid-123', FAKE_PERSONALITY);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { discordId: 'discord-1' },
          select: expect.objectContaining({
            id: true,
            defaultTtsConfigId: true,
          }),
        })
      );
    });
  });

  describe('user-not-found caching', () => {
    it('caches the user-not-found resolution (single lookup for repeat calls)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.personalityDefaultTtsConfig.findUnique.mockResolvedValue(null);
      mockPrisma.adminSettings.findUnique.mockResolvedValue(null);

      await resolver.resolveConfig('discord-1', 'p-uuid-123', FAKE_PERSONALITY);
      await resolver.resolveConfig('discord-1', 'p-uuid-123', FAKE_PERSONALITY);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('absent tiers stay quiet', () => {
    // "No row configured" is the normal state, not a failure: it must fall
    // through on the silent path. The ERROR log is reserved for actual lookup
    // failures (that severity contract is pinned elsewhere in this file).

    it('does not ERROR-log when the personality simply has no TTS default', async () => {
      mockLoggerError.mockClear();
      mockPrisma.personalityDefaultTtsConfig.findUnique.mockResolvedValue(null);
      mockPrisma.adminSettings.findUnique.mockResolvedValue(null);

      await resolver.resolveConfig(undefined, 'p-uuid-123', FAKE_PERSONALITY);

      expect(mockLoggerError).not.toHaveBeenCalled();
    });

    it('getFreeDefaultConfig returns null without an error log when the admin row is absent', async () => {
      mockLoggerError.mockClear();
      mockPrisma.adminSettings.findUnique.mockResolvedValue(null);

      expect(await resolver.getFreeDefaultConfig()).toBeNull();
      expect(mockLoggerError).not.toHaveBeenCalled();
    });

    it('getFreeDefaultConfig returns null without an error log when the pointer is unset', async () => {
      mockLoggerError.mockClear();
      mockPrisma.adminSettings.findUnique.mockResolvedValue({ freeDefaultTtsConfig: null });

      expect(await resolver.getFreeDefaultConfig()).toBeNull();
      expect(mockLoggerError).not.toHaveBeenCalled();
    });
  });
});
