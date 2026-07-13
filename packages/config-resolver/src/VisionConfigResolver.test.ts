import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VisionConfigResolver } from './VisionConfigResolver.js';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';

// Hoisted logger spies so tests can assert the WARN→ERROR upgrade for a failed
// personality-default lookup (a behavioral contract, mirroring TtsConfigResolver).
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
  personalityVisionDefaultConfig: { findUnique: ReturnType<typeof vi.fn> };
  llmConfig: { findFirst: ReturnType<typeof vi.fn> };
  adminSettings: { findUnique: ReturnType<typeof vi.fn> };
}

function createMockPrisma(): MockPrisma {
  return {
    user: { findFirst: vi.fn() },
    userPersonalityConfig: { findFirst: vi.fn() },
    personalityVisionDefaultConfig: { findUnique: vi.fn() },
    llmConfig: { findFirst: vi.fn() },
    adminSettings: { findUnique: vi.fn() },
  };
}

/**
 * A complete `kind='vision'` LlmConfig row in the shape the shared LLM mapper
 * (`LLM_CONFIG_SELECT_WITH_NAME`) reads. Vision configs ARE LlmConfig rows, so the
 * resolver reuses that mapper — `model` + `name` + the row's explicitly-set
 * vision-callable params end up in the resolved result.
 */
function visionRow(
  over: { model?: string; name?: string; advancedParameters?: Record<string, unknown> } = {}
): Record<string, unknown> {
  return {
    model: over.model ?? 'qwen/qwen3-vl-235b-a22b-instruct',
    provider: 'openrouter',
    advancedParameters: over.advancedParameters ?? null,
    memoryScoreThreshold: null,
    memoryLimit: null,
    contextWindowTokens: 8192,
    maxMessages: 20,
    maxAge: null,
    maxImages: 4,
    name: over.name ?? 'vision-cfg',
  };
}

const FAKE_PERSONALITY = { id: 'p-uuid-123' };

describe('VisionConfigResolver', () => {
  afterEach(() => resetSystemSettingsRegistration());

  let mockPrisma: MockPrisma;
  let resolver: VisionConfigResolver;

  beforeEach(() => {
    vi.useFakeTimers();
    mockPrisma = createMockPrisma();
    resolver = new VisionConfigResolver(mockPrisma as unknown as PrismaClient, {
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
    it('returns the user per-personality override (tier 1)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-x',
        defaultVisionConfigId: null,
        defaultVisionConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue({
        visionConfig: visionRow({ model: 'user-pers-vision', name: 'user-pers-override' }),
      });

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

      expect(result.source).toBe('user-personality');
      expect(result.config.source).toBe('user-personality');
      expect(result.config.model).toBe('user-pers-vision');
      expect(result.configName).toBe('user-pers-override');
    });

    it("carries the row's explicitly-set params through the REAL mapper (tier 1)", async () => {
      // The round-1 review of the vision-params feature found the resolver
      // discarding every sampling field — this pins the real end-to-end path
      // (DB row JSONB → mapper → ResolvedVisionConfig.params) so contract
      // drift between the resolver and the gateway stamp can't recur silently.
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-x',
        defaultVisionConfigId: null,
        defaultVisionConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue({
        visionConfig: visionRow({
          model: 'user-pers-vision',
          name: 'user-pers-override',
          // JSONB is snake_case; the mapper converts to camelCase
          advancedParameters: { temperature: 0.7, max_tokens: 2048, seed: 42 },
        }),
      });

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

      expect(result.config.params).toEqual({ temperature: 0.7, maxTokens: 2048, seed: 42 });
    });

    it('omits params when the row sets none (no empty-object noise)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-x',
        defaultVisionConfigId: null,
        defaultVisionConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue({
        visionConfig: visionRow({ model: 'user-pers-vision', name: 'user-pers-override' }),
      });

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

      expect(result.config.params).toBeUndefined();
    });

    it('returns the user global default when no per-personality override (tier 2)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-x',
        defaultVisionConfigId: 'cfg-id',
        defaultVisionConfig: visionRow({ model: 'user-default-vision', name: 'my-vision-default' }),
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

      expect(result.source).toBe('user-default');
      expect(result.config.source).toBe('user-default');
      expect(result.config.model).toBe('user-default-vision');
      expect(result.configName).toBe('my-vision-default');
    });

    it('falls through to PersonalityVisionDefaultConfig (tier 3) when the user has no overrides', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-x',
        defaultVisionConfigId: null,
        defaultVisionConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);
      mockPrisma.personalityVisionDefaultConfig.findUnique.mockResolvedValue({
        llmConfig: visionRow({ model: 'persona-vision', name: 'persona-vision-default' }),
      });

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

      // Tier 3 surfaces as the 'personality' (system-default) tier.
      expect(result.source).toBe('personality');
      expect(result.config.source).toBe('personality');
      expect(result.config.model).toBe('persona-vision');
    });

    it('falls through to the global vision default (tier 4) when no personality default', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-x',
        defaultVisionConfigId: null,
        defaultVisionConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);
      mockPrisma.personalityVisionDefaultConfig.findUnique.mockResolvedValue(null);
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        globalDefaultVisionConfig: visionRow({
          model: 'global-vision-default',
          name: 'global-vision',
        }),
      });

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

      // The global vision default is surfaced as the 'personality' (system-default) tier,
      // mirroring how the text resolver surfaces its baked-in global default.
      expect(result.source).toBe('personality');
      expect(result.config.model).toBe('global-vision-default');
    });

    it('falls through to the LIVE fallbackVisionModel setting (tier 5) when no DB row at any tier', async () => {
      registerSystemSettings({
        get: (key: string) =>
          key === 'fallbackVisionModel' ? 'divergent/vision-terminal' : undefined,
      } as unknown as SystemSettingsService);
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-x',
        defaultVisionConfigId: null,
        defaultVisionConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);
      mockPrisma.personalityVisionDefaultConfig.findUnique.mockResolvedValue(null);
      mockPrisma.adminSettings.findUnique.mockResolvedValue({ globalDefaultVisionConfig: null });

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

      expect(result.source).toBe('hardcoded');
      expect(result.config.source).toBe('hardcoded');
      expect(result.config.model).toBe('divergent/vision-terminal');
    });

    it('returns the cascade terminal with no userId, no personality default, no global default', async () => {
      registerSystemSettings({
        get: (key: string) =>
          key === 'fallbackVisionModel' ? 'divergent/vision-terminal' : undefined,
      } as unknown as SystemSettingsService);
      mockPrisma.personalityVisionDefaultConfig.findUnique.mockResolvedValue(null);
      mockPrisma.adminSettings.findUnique.mockResolvedValue({ globalDefaultVisionConfig: null });

      const result = await resolver.resolveConfig(undefined, 'p-uuid-123', FAKE_PERSONALITY);

      expect(result.source).toBe('hardcoded');
      expect(result.config.model).toBe('divergent/vision-terminal');
      // No userId → user-tier lookups skipped.
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('logs at ERROR severity when the PersonalityVisionDefaultConfig lookup throws (not WARN)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'internal-x',
        defaultVisionConfigId: null,
        defaultVisionConfig: null,
      });
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);
      mockPrisma.personalityVisionDefaultConfig.findUnique.mockRejectedValue(
        new Error('connection refused')
      );
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        globalDefaultVisionConfig: visionRow({
          model: 'global-vision-default',
          name: 'global-vision',
        }),
      });

      const result = await resolver.resolveConfig('user-x', 'p-uuid-123', FAKE_PERSONALITY);

      // Still falls through to the global default — no behavior regression.
      expect(result.config.model).toBe('global-vision-default');

      const errorCall = mockLoggerError.mock.calls.find(call =>
        String(call[1]).includes('Failed to load PersonalityVisionDefaultConfig')
      );
      expect(errorCall).toBeDefined();
      expect((errorCall![0] as Record<string, unknown>).personalityId).toBe('p-uuid-123');
    });
  });

  describe('getGlobalDefaultConfig', () => {
    it('reads the global vision default via the AdminSettings pointer', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        globalDefaultVisionConfig: visionRow({
          model: 'global-vision-default',
          name: 'global-vision',
        }),
      });

      await resolver.getGlobalDefaultConfig();

      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { globalDefaultVisionConfig: { select: expect.any(Object) } },
        })
      );
    });

    it('returns null when no global vision default row exists', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({ globalDefaultVisionConfig: null });
      const result = await resolver.getGlobalDefaultConfig();
      expect(result).toBeNull();
    });

    it('negative-caches the null result (second call does not re-query)', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({ globalDefaultVisionConfig: null });

      const first = await resolver.getGlobalDefaultConfig();
      const second = await resolver.getGlobalDefaultConfig();

      expect(first).toBeNull();
      expect(second).toBeNull();
      // The pre-seed window (no global default row) must not re-query the DB on
      // every call — the negative cache short-circuits the second lookup.
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(1);
    });

    it('caches the global-default result (second call hits cache)', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        globalDefaultVisionConfig: visionRow({
          model: 'global-vision-default',
          name: 'global-vision',
        }),
      });

      await resolver.getGlobalDefaultConfig();
      await resolver.getGlobalDefaultConfig();

      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(1);
    });

    it('clearCache() clears the negative sentinel so a newly-created global default is seen', async () => {
      // First call: no global default yet → negative sentinel set.
      mockPrisma.adminSettings.findUnique.mockResolvedValueOnce({
        globalDefaultVisionConfig: null,
      });
      expect(await resolver.getGlobalDefaultConfig()).toBeNull();
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(1);

      // An admin creates the global default; the pub/sub invalidation clears caches.
      resolver.clearCache();

      // Next call must re-query (not short-circuit on the stale negative sentinel)
      // and surface the new row.
      mockPrisma.adminSettings.findUnique.mockResolvedValueOnce({
        globalDefaultVisionConfig: visionRow({
          model: 'newly-created-default',
          name: 'new-global-vision',
        }),
      });
      const after = await resolver.getGlobalDefaultConfig();
      expect(after?.model).toBe('newly-created-default');
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('getFreeDefaultVisionConfig', () => {
    it('reads the free vision default via the AdminSettings pointer', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        freeDefaultVisionConfig: visionRow({ model: 'free-vision-default', name: 'free-vision' }),
      });

      const result = await resolver.getFreeDefaultVisionConfig();

      expect(result?.model).toBe('free-vision-default');
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { freeDefaultVisionConfig: { select: expect.any(Object) } },
        })
      );
    });

    it('returns null when no free vision default row exists', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({ freeDefaultVisionConfig: null });
      expect(await resolver.getFreeDefaultVisionConfig()).toBeNull();
    });

    it('negative-caches the null result (second call does not re-query)', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({ freeDefaultVisionConfig: null });

      await resolver.getFreeDefaultVisionConfig();
      await resolver.getFreeDefaultVisionConfig();

      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(1);
    });

    it('caches the free-default result (second call hits cache)', async () => {
      mockPrisma.adminSettings.findUnique.mockResolvedValue({
        freeDefaultVisionConfig: visionRow({ model: 'free-vision-default', name: 'free-vision' }),
      });

      await resolver.getFreeDefaultVisionConfig();
      await resolver.getFreeDefaultVisionConfig();

      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(1);
    });

    it('keeps the free + global negative sentinels independent (shared cache, distinct keys)', async () => {
      // A missing GLOBAL default must not suppress a subsequent FREE lookup — the two
      // sentinels live in the same noDefaultCache under different keys.
      mockPrisma.adminSettings.findUnique.mockResolvedValueOnce({
        globalDefaultVisionConfig: null,
      });
      expect(await resolver.getGlobalDefaultConfig()).toBeNull();

      mockPrisma.adminSettings.findUnique.mockResolvedValueOnce({
        freeDefaultVisionConfig: visionRow({ model: 'free-vision-default', name: 'free-vision' }),
      });
      const free = await resolver.getFreeDefaultVisionConfig();
      expect(free?.model).toBe('free-vision-default');
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('constructor options', () => {
    it('constructs without an options argument and still resolves system defaults', async () => {
      // Every options access (positive AND negative cache) must tolerate
      // `undefined` — production call sites construct resolvers bare.
      const bare = new VisionConfigResolver(mockPrisma as unknown as PrismaClient);
      mockPrisma.adminSettings.findUnique.mockResolvedValue(null);

      expect(await bare.getGlobalDefaultConfig()).toBeNull();
    });

    it('applies a custom cacheTtlMs to the negative-default sentinel', async () => {
      // The sentinel must expire on the SAME custom window as the positive
      // cache — a longer sentinel would mask a newly-created default until
      // the wrong TTL elapsed.
      const short = new VisionConfigResolver(mockPrisma as unknown as PrismaClient, {
        cacheTtlMs: 1_000,
        now: () => Date.now(),
      });
      mockPrisma.adminSettings.findUnique.mockResolvedValue(null);

      await short.getGlobalDefaultConfig(); // miss → sentinel set
      vi.advanceTimersByTime(1_500); // past the CUSTOM ttl
      await short.getGlobalDefaultConfig(); // sentinel expired → re-query

      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('negative-default caching for an absent admin row', () => {
    // The admin_settings row itself missing (fresh DB pre-bootstrap) must
    // behave exactly like an unset pointer: null result, negative-cached,
    // no error log.

    it('getGlobalDefaultConfig caches the miss without an error log', async () => {
      mockLoggerError.mockClear();
      mockPrisma.adminSettings.findUnique.mockResolvedValue(null);

      expect(await resolver.getGlobalDefaultConfig()).toBeNull();
      expect(await resolver.getGlobalDefaultConfig()).toBeNull();

      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(1);
      expect(mockLoggerError).not.toHaveBeenCalled();
    });

    it('getFreeDefaultVisionConfig caches the miss without an error log', async () => {
      mockLoggerError.mockClear();
      mockPrisma.adminSettings.findUnique.mockResolvedValue(null);

      expect(await resolver.getFreeDefaultVisionConfig()).toBeNull();
      expect(await resolver.getFreeDefaultVisionConfig()).toBeNull();

      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledTimes(1);
      expect(mockLoggerError).not.toHaveBeenCalled();
    });
  });

  describe('query shapes (the Prisma seam)', () => {
    it('selects the user row with the default-vision join flags', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.personalityVisionDefaultConfig.findUnique.mockResolvedValue(null);
      mockPrisma.adminSettings.findUnique.mockResolvedValue(null);

      await resolver.resolveConfig('discord-1', 'p-uuid-123', FAKE_PERSONALITY);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { discordId: 'discord-1' },
          select: expect.objectContaining({
            id: true,
            defaultVisionConfigId: true,
          }),
        })
      );
    });
  });

  describe('user-not-found caching', () => {
    it('caches the user-not-found resolution (single lookup for repeat calls)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.personalityVisionDefaultConfig.findUnique.mockResolvedValue(null);
      mockPrisma.adminSettings.findUnique.mockResolvedValue(null);

      await resolver.resolveConfig('discord-1', 'p-uuid-123', FAKE_PERSONALITY);
      await resolver.resolveConfig('discord-1', 'p-uuid-123', FAKE_PERSONALITY);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('absent tiers stay quiet', () => {
    it('does not ERROR-log when the personality simply has no vision default', async () => {
      mockLoggerError.mockClear();
      mockPrisma.personalityVisionDefaultConfig.findUnique.mockResolvedValue(null);
      mockPrisma.adminSettings.findUnique.mockResolvedValue(null);

      await resolver.resolveConfig(undefined, 'p-uuid-123', FAKE_PERSONALITY);

      expect(mockLoggerError).not.toHaveBeenCalled();
    });
  });
});
