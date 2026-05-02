import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TtsConfigResolver } from './TtsConfigResolver.js';
import type { PrismaClient } from './prisma.js';

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

interface MockPrisma {
  user: { findFirst: ReturnType<typeof vi.fn> };
  userPersonalityConfig: { findFirst: ReturnType<typeof vi.fn> };
  personalityDefaultTtsConfig: { findUnique: ReturnType<typeof vi.fn> };
  ttsConfig: { findFirst: ReturnType<typeof vi.fn> };
}

function createMockPrisma(): MockPrisma {
  return {
    user: { findFirst: vi.fn() },
    userPersonalityConfig: { findFirst: vi.fn() },
    personalityDefaultTtsConfig: { findUnique: vi.fn() },
    ttsConfig: { findFirst: vi.fn() },
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
      mockPrisma.ttsConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveConfig(undefined, 'p-uuid-123', FAKE_PERSONALITY);

      expect(result.config.provider).toBe('self-hosted');
      expect(result.config.modelId).toBeNull();
      expect(result.source).toBe('personality'); // base wraps the extract result
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

      // The base wraps extractFromPersonality output's source as 'personality'.
      // Inside extract we set source: 'personality' for tier 3, which gets through.
      expect(result.config.provider).toBe('mistral');
      expect(result.config.modelId).toBe('voxtral-mini-tts-2603');
    });

    it('falls through to system free default (tier 4) when no PersonalityDefaultTtsConfig', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-x',
        defaultTtsConfigId: null,
        defaultTtsConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);
      mockPrisma.personalityDefaultTtsConfig.findUnique.mockResolvedValue(null);
      mockPrisma.ttsConfig.findFirst.mockResolvedValue({
        name: 'kyutai-self-hosted',
        provider: 'self-hosted',
        modelId: null,
        advancedParameters: null,
        isGlobal: true,
        isDefault: false,
        isFreeDefault: true,
      });

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

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
      mockPrisma.ttsConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

      expect(result.config.provider).toBe('self-hosted');
      expect(result.config.modelId).toBeNull();
      expect(result.config.advancedParameters).toEqual({});
    });
  });

  describe('getFreeDefaultConfig', () => {
    it('returns null when no isFreeDefault row exists', async () => {
      mockPrisma.ttsConfig.findFirst.mockResolvedValue(null);
      const result = await resolver.getFreeDefaultConfig();
      expect(result).toBeNull();
    });

    it('returns mapped config when an isFreeDefault row exists', async () => {
      mockPrisma.ttsConfig.findFirst.mockResolvedValue({
        name: 'kyutai-self-hosted',
        provider: 'self-hosted',
        modelId: null,
        advancedParameters: null,
        isGlobal: true,
        isDefault: false,
        isFreeDefault: true,
      });

      const result = await resolver.getFreeDefaultConfig();

      expect(result).not.toBeNull();
      expect(result?.provider).toBe('self-hosted');
      expect(result?.source).toBe('free-default');
      expect(result?.configName).toBe('kyutai-self-hosted');
    });

    it('caches the free-default result', async () => {
      const firstCall = mockPrisma.ttsConfig.findFirst.mockResolvedValue({
        name: 'kyutai-self-hosted',
        provider: 'self-hosted',
        modelId: null,
        advancedParameters: null,
        isGlobal: true,
        isDefault: false,
        isFreeDefault: true,
      });

      await resolver.getFreeDefaultConfig();
      await resolver.getFreeDefaultConfig();

      expect(firstCall).toHaveBeenCalledTimes(1); // second call hit cache
    });
  });
});
