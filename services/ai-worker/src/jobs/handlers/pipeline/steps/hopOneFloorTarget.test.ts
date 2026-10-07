import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import type { AttemptedRoute, QuotaFallbackCaches } from '../../../../services/quotaFallback.js';
import type { GenerateAttemptOpts } from './autoPromotionFallback.js';
import { selectHopOneFloorTarget } from './hopOneFloorTarget.js';

const { mockLogger } = vi.hoisted(() => {
  const instance = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => instance,
  };
  return { mockLogger: instance };
});
vi.mock('@tzurot/common-types/utils/logger', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createLogger: () => mockLogger,
}));

const FLOOR = 'z-ai/glm-5.3-flash';

function buildCaches(): QuotaFallbackCaches {
  return {
    creditExhaustion: { isCreditExhausted: vi.fn().mockResolvedValue({ exhausted: false }) },
    rateLimit: { isRateLimited: vi.fn().mockResolvedValue({ rateLimited: false }) },
  } as unknown as QuotaFallbackCaches;
}

function buildOpts(): GenerateAttemptOpts {
  return {
    personality: {
      id: 'p1',
      name: 'Testy',
      model: 'glm-5.3-flash',
      provider: 'zai-coding',
    } as unknown as GenerateAttemptOpts['personality'],
    message: 'hello',
    conversationContext: {} as GenerateAttemptOpts['conversationContext'],
    recentAssistantMessages: [],
    apiKey: 'sk-user-key',
    sttDispatch: undefined,
    isGuestMode: false,
    jobId: 'job-1',
  };
}

describe('selectHopOneFloorTarget', () => {
  beforeEach(() => {
    mockLogger.debug.mockClear();
    registerSystemSettings({
      get: (key: string) => (key === 'fallbackTextModel' ? FLOOR : undefined),
    } as unknown as SystemSettingsService);
  });
  afterEach(() => resetSystemSettingsRegistration());

  const select = (category: ApiErrorCategory, excludeRoutes?: readonly AttemptedRoute[]) =>
    selectHopOneFloorTarget({
      category: category as never,
      opts: buildOpts(),
      cacheKeyId: 'user:123',
      caches: buildCaches(),
      excludeRoutes,
    });

  it('is terminal on credit exhaustion (no solvent billing entity)', async () => {
    expect(await select(ApiErrorCategory.CREDIT_EXHAUSTION)).toBeNull();
  });

  it('returns the paid floor when nothing excludes it', async () => {
    const target = await select(ApiErrorCategory.TIMEOUT);
    expect(target?.config.model).toBe(FLOOR);
  });

  it('returns null and names the cause when the floor is an OpenRouter route already attempted', async () => {
    const target = await select(ApiErrorCategory.TIMEOUT, [
      { provider: 'zai-coding', model: 'glm-5.3-flash' },
      { provider: 'openrouter', model: FLOOR },
    ] satisfies AttemptedRoute[]);

    expect(target).toBeNull();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        floorModel: FLOOR,
        cause: 'this job already attempted the floor route',
      }),
      'No hop-1 retarget and the floor is unavailable — terminal'
    );
  });

  function registerFloor(model: string): void {
    registerSystemSettings({
      get: (key: string) => (key === 'fallbackTextModel' ? model : undefined),
    } as unknown as SystemSettingsService);
  }

  it('names "no floor model is configured" when the floor setting is empty', async () => {
    registerFloor('');

    expect(await select(ApiErrorCategory.TIMEOUT)).toBeNull();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'no floor model is configured' }),
      'No hop-1 retarget and the floor is unavailable — terminal'
    );
  });

  it('names "the floor IS the failing model" when the floor equals the failing model', async () => {
    registerFloor('glm-5.3-flash');

    expect(await select(ApiErrorCategory.TIMEOUT)).toBeNull();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        floorModel: 'glm-5.3-flash',
        cause: 'the floor IS the failing model',
      }),
      'No hop-1 retarget and the floor is unavailable — terminal'
    );
  });

  it('names the doom-cache veto when a rate-limit mark rules out the configured floor', async () => {
    const caches = buildCaches();
    (caches.rateLimit.isRateLimited as ReturnType<typeof vi.fn>).mockResolvedValue({
      rateLimited: true,
    });

    const target = await selectHopOneFloorTarget({
      category: ApiErrorCategory.TIMEOUT as never,
      opts: buildOpts(),
      cacheKeyId: 'user:123',
      caches,
    });

    expect(target).toBeNull();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ floorModel: FLOOR, cause: 'the doom caches veto it' }),
      'No hop-1 retarget and the floor is unavailable — terminal'
    );
  });

  it('degrades to null and warns when floor selection throws, never rejecting', async () => {
    mockLogger.warn.mockClear();
    const caches = buildCaches();
    (caches.rateLimit.isRateLimited as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('cache blew up')
    );

    const target = await selectHopOneFloorTarget({
      category: ApiErrorCategory.TIMEOUT as never,
      opts: buildOpts(),
      cacheKeyId: 'user:123',
      caches,
    });

    expect(target).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1', failingModel: 'glm-5.3-flash' }),
      'Floor selection threw — treating the floor as unavailable'
    );
  });

  it('still returns the floor when only a different provider ran the same canonical model', async () => {
    const target = await select(ApiErrorCategory.TIMEOUT, [
      { provider: 'zai-coding', model: 'glm-5.3-flash' },
    ] satisfies AttemptedRoute[]);
    expect(target?.config.model).toBe(FLOOR);
  });
});
