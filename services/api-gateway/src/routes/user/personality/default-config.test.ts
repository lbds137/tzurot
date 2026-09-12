/**
 * Tests for PUT/DELETE /user/personality/:slug/default-config
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import type { OpenRouterModelCache } from '../../../services/OpenRouterModelCache.js';
import {
  createMockPrisma,
  createMockReqRes,
  setupStandardMocks,
  MOCK_USER_ID,
} from './test-utils.js';

// Mock dependencies before imports
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

import {
  handleSetPersonalityDefaultConfig,
  handleClearPersonalityDefaultConfig,
} from './default-config.js';
import { asRouteHandler, stubRouteResolvers } from '../../../test/shared-route-test-utils.js';
import type { RouteDeps } from '../../routeDeps.js';

const PERSONALITY_ID = '7e570000-0000-4000-8000-000000000020';
const CONFIG_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

/** Vision-capable stub model cache — `getModelById` resolves the given model id as vision-capable. */
function visionCapableModelCache(modelId: string): OpenRouterModelCache {
  return {
    supportsReasoning: vi.fn().mockResolvedValue(undefined),
    getModelById: vi.fn(async (id: string) => (id === modelId ? { supportsVision: true } : null)),
  } as unknown as OpenRouterModelCache;
}

/** Non-vision-capable stub model cache — every model resolves supportsVision: false. */
function nonVisionModelCache(modelId: string): OpenRouterModelCache {
  return {
    supportsReasoning: vi.fn().mockResolvedValue(undefined),
    getModelById: vi.fn(async (id: string) => (id === modelId ? { supportsVision: false } : null)),
  } as unknown as OpenRouterModelCache;
}

describe('PUT/DELETE /api/user/personality/:slug/default-config', () => {
  const mockPrisma = createMockPrisma();
  const invalidatePersonality = vi.fn().mockResolvedValue(undefined);
  const invalidateAll = vi.fn().mockResolvedValue(undefined);

  function buildDeps(extra: Partial<RouteDeps> = {}): RouteDeps {
    return {
      ...stubRouteResolvers(),
      prisma: mockPrisma as unknown as PrismaClient,
      cacheInvalidationService: {
        invalidatePersonality,
      } as unknown as RouteDeps['cacheInvalidationService'],
      llmConfigCacheInvalidation: {
        invalidateAll,
      } as unknown as RouteDeps['llmConfigCacheInvalidation'],
      ...extra,
    } as RouteDeps;
  }

  const getSetHandler = (extra: Partial<RouteDeps> = {}): ReturnType<typeof asRouteHandler> =>
    asRouteHandler(handleSetPersonalityDefaultConfig(buildDeps(extra)));
  const getClearHandler = (extra: Partial<RouteDeps> = {}): ReturnType<typeof asRouteHandler> =>
    asRouteHandler(handleClearPersonalityDefaultConfig(buildDeps(extra)));

  beforeEach(() => {
    vi.clearAllMocks();
    setupStandardMocks(mockPrisma);
    invalidatePersonality.mockResolvedValue(undefined);
    invalidateAll.mockResolvedValue(undefined);
    mockPrisma.personality.findUnique.mockResolvedValue({
      id: PERSONALITY_ID,
      ownerId: MOCK_USER_ID,
    });
    mockPrisma.personalityDefaultConfig.upsert.mockResolvedValue({});
    mockPrisma.personalityVisionDefaultConfig.upsert.mockResolvedValue({});
    mockPrisma.personalityDefaultConfig.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.personalityVisionDefaultConfig.deleteMany.mockResolvedValue({ count: 0 });
  });

  describe('PUT', () => {
    it('rejects an invalid ?slot= value with 400', async () => {
      const handler = getSetHandler();
      const { req, res } = createMockReqRes(
        { configId: CONFIG_ID },
        { slug: 'my-char' },
        { slot: 'audio' }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.personalityDefaultConfig.upsert).not.toHaveBeenCalled();
    });

    // C1: non-owner PUT → 403, no upsert.
    it('returns 403 when the caller does not own the personality', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: PERSONALITY_ID,
        ownerId: 'someone-else',
      });
      mockPrisma.personalityOwner.findUnique.mockResolvedValue(null);

      const handler = getSetHandler();
      const { req, res } = createMockReqRes({ configId: CONFIG_ID }, { slug: 'not-mine' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockPrisma.personalityDefaultConfig.upsert).not.toHaveBeenCalled();
    });

    // C2: verifyConfigAccess cannot see the config → 404, no upsert.
    it('returns 404 when the config is not accessible to the caller', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue(null);

      const handler = getSetHandler();
      const { req, res } = createMockReqRes({ configId: CONFIG_ID }, { slug: 'my-char' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockPrisma.personalityDefaultConfig.upsert).not.toHaveBeenCalled();
    });

    // C3: vision slot with a non-vision-capable model → 400, neither upsert.
    it('rejects the vision slot when the model is not vision-capable', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: CONFIG_ID,
        name: 'Text Only',
        model: 'openai/gpt-text-only',
      });

      const handler = getSetHandler({ modelCache: nonVisionModelCache('openai/gpt-text-only') });
      const { req, res } = createMockReqRes(
        { configId: CONFIG_ID },
        { slug: 'my-char' },
        { slot: 'vision' }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.personalityDefaultConfig.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.personalityVisionDefaultConfig.upsert).not.toHaveBeenCalled();
    });

    // C4: text-slot write seam assertion.
    it('upserts personalityDefaultConfig with exactly the expected shape (text slot)', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: CONFIG_ID,
        name: 'My Config',
        model: 'anthropic/claude-sonnet-4',
      });

      const handler = getSetHandler();
      const { req, res } = createMockReqRes({ configId: CONFIG_ID }, { slug: 'my-char' });

      await handler(req, res);

      expect(mockPrisma.personalityDefaultConfig.upsert).toHaveBeenCalledWith({
        where: { personalityId: PERSONALITY_ID },
        create: { personalityId: PERSONALITY_ID, llmConfigId: CONFIG_ID },
        update: { llmConfigId: CONFIG_ID },
      });
      expect(mockPrisma.personalityVisionDefaultConfig.upsert).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          slot: 'text',
          config: { id: CONFIG_ID, name: 'My Config', model: 'anthropic/claude-sonnet-4' },
        })
      );
    });

    // C4: vision-slot write seam assertion — vision table written, text table NOT.
    it('upserts personalityVisionDefaultConfig and NOT personalityDefaultConfig (vision slot)', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: CONFIG_ID,
        name: 'Vision Config',
        model: 'openai/gpt-4o',
      });

      const handler = getSetHandler({ modelCache: visionCapableModelCache('openai/gpt-4o') });
      const { req, res } = createMockReqRes(
        { configId: CONFIG_ID },
        { slug: 'my-char' },
        { slot: 'vision' }
      );

      await handler(req, res);

      expect(mockPrisma.personalityVisionDefaultConfig.upsert).toHaveBeenCalledWith({
        where: { personalityId: PERSONALITY_ID },
        create: { personalityId: PERSONALITY_ID, llmConfigId: CONFIG_ID },
        update: { llmConfigId: CONFIG_ID },
      });
      expect(mockPrisma.personalityDefaultConfig.upsert).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          slot: 'vision',
          config: { id: CONFIG_ID, name: 'Vision Config', model: 'openai/gpt-4o' },
        })
      );
    });

    // C5: both invalidation calls fire on PUT.
    it('invalidates the personality cache AND the LLM config cache on a successful set', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: CONFIG_ID,
        name: 'My Config',
        model: 'anthropic/claude-sonnet-4',
      });

      const handler = getSetHandler();
      const { req, res } = createMockReqRes({ configId: CONFIG_ID }, { slug: 'my-char' });

      await handler(req, res);

      expect(invalidatePersonality).toHaveBeenCalledWith(PERSONALITY_ID);
      expect(invalidateAll).toHaveBeenCalledWith();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    // C5: a rejected invalidation call must not fail the request.
    it('still returns 200 when cache invalidation rejects', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: CONFIG_ID,
        name: 'My Config',
        model: 'anthropic/claude-sonnet-4',
      });
      invalidatePersonality.mockRejectedValue(new Error('redis down'));

      const handler = getSetHandler();
      const { req, res } = createMockReqRes({ configId: CONFIG_ID }, { slug: 'my-char' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(invalidateAll).toHaveBeenCalledWith();
    });

    // C5: a rejected LLM config cache invalidation must not fail the request either.
    it('still returns 200 when LLM config cache invalidation rejects', async () => {
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: CONFIG_ID,
        name: 'My Config',
        model: 'anthropic/claude-sonnet-4',
      });
      invalidateAll.mockRejectedValue(new Error('redis down'));

      const handler = getSetHandler();
      const { req, res } = createMockReqRes({ configId: CONFIG_ID }, { slug: 'my-char' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(invalidatePersonality).toHaveBeenCalledWith(PERSONALITY_ID);
    });
  });

  describe('DELETE', () => {
    it('rejects an invalid ?slot= value with 400', async () => {
      const handler = getClearHandler();
      const { req, res } = createMockReqRes({}, { slug: 'my-char' }, { slot: 'audio' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.personalityDefaultConfig.deleteMany).not.toHaveBeenCalled();
    });

    it('returns 403 when the caller does not own the personality', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: PERSONALITY_ID,
        ownerId: 'someone-else',
      });
      mockPrisma.personalityOwner.findUnique.mockResolvedValue(null);

      const handler = getClearHandler();
      const { req, res } = createMockReqRes({}, { slug: 'not-mine' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockPrisma.personalityDefaultConfig.deleteMany).not.toHaveBeenCalled();
    });

    // C6: DELETE on an absent row is idempotent — 200 success:true.
    it('is idempotent when no row exists (text slot)', async () => {
      const handler = getClearHandler();
      const { req, res } = createMockReqRes({}, { slug: 'my-char' });

      await handler(req, res);

      expect(mockPrisma.personalityDefaultConfig.deleteMany).toHaveBeenCalledWith({
        where: { personalityId: PERSONALITY_ID },
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('clears the vision slot table, not the text slot table', async () => {
      const handler = getClearHandler();
      const { req, res } = createMockReqRes({}, { slug: 'my-char' }, { slot: 'vision' });

      await handler(req, res);

      expect(mockPrisma.personalityVisionDefaultConfig.deleteMany).toHaveBeenCalledWith({
        where: { personalityId: PERSONALITY_ID },
      });
      expect(mockPrisma.personalityDefaultConfig.deleteMany).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    // C5: both invalidation calls fire on DELETE too.
    it('invalidates the personality cache AND the LLM config cache on clear', async () => {
      const handler = getClearHandler();
      const { req, res } = createMockReqRes({}, { slug: 'my-char' });

      await handler(req, res);

      expect(invalidatePersonality).toHaveBeenCalledWith(PERSONALITY_ID);
      expect(invalidateAll).toHaveBeenCalledWith();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    // C5: a rejected invalidation call must not fail the request.
    it('still returns 200 when cache invalidation rejects', async () => {
      invalidatePersonality.mockRejectedValue(new Error('redis down'));

      const handler = getClearHandler();
      const { req, res } = createMockReqRes({}, { slug: 'my-char' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(invalidateAll).toHaveBeenCalledWith();
    });

    // C5: a rejected LLM config cache invalidation must not fail the request either.
    it('still returns 200 when LLM config cache invalidation rejects', async () => {
      invalidateAll.mockRejectedValue(new Error('redis down'));

      const handler = getClearHandler();
      const { req, res } = createMockReqRes({}, { slug: 'my-char' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(invalidatePersonality).toHaveBeenCalledWith(PERSONALITY_ID);
    });
  });
});
