/**
 * Tests for /models routes
 *
 * Tests model listing with filtering and admin cache refresh.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock dependencies before imports
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    isBotOwner: vi.fn((id: string) => id === 'bot-owner-123'),
  };
});

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

import { createModelsRouter } from './index.js';
import type { OpenRouterModelCache } from '../../services/OpenRouterModelCache.js';
import type { ModelAutocompleteOption } from '@tzurot/common-types';
import { getRouteHandler, findRoute } from '../../test/expressRouterUtils.js';

// Sample autocomplete options for testing
const sampleTextModels: ModelAutocompleteOption[] = [
  {
    id: 'anthropic/claude-sonnet-4',
    name: 'Anthropic: Claude Sonnet 4',
    contextLength: 200000,
    supportsVision: false,
    supportsImageGeneration: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    promptPricePerMillion: 3,
    completionPricePerMillion: 15,
  },
  {
    id: 'openai/gpt-4o',
    name: 'OpenAI: GPT-4o',
    contextLength: 128000,
    supportsVision: true,
    supportsImageGeneration: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    promptPricePerMillion: 5,
    completionPricePerMillion: 15,
  },
];

const sampleVisionModels: ModelAutocompleteOption[] = [
  {
    id: 'openai/gpt-4o',
    name: 'OpenAI: GPT-4o',
    contextLength: 128000,
    supportsVision: true,
    supportsImageGeneration: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    promptPricePerMillion: 5,
    completionPricePerMillion: 15,
  },
];

const sampleImageGenModels: ModelAutocompleteOption[] = [
  {
    id: 'dall-e/dall-e-3',
    name: 'DALL-E 3',
    contextLength: 4096,
    supportsVision: false,
    supportsImageGeneration: true,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    promptPricePerMillion: 40,
    completionPricePerMillion: 0,
  },
];

// Create mock model cache
function createMockModelCache(): OpenRouterModelCache {
  return {
    getFilteredModels: vi.fn().mockResolvedValue(sampleTextModels),
    getTextModels: vi.fn().mockResolvedValue(sampleTextModels),
    getVisionModels: vi.fn().mockResolvedValue(sampleVisionModels),
    getImageGenerationModels: vi.fn().mockResolvedValue(sampleImageGenModels),
    refreshCache: vi.fn().mockResolvedValue(100),
  } as unknown as OpenRouterModelCache;
}

// Helper to create mock request/response
function createMockReqRes(
  query: Record<string, string> = {},
  headers: Record<string, string> = {}
) {
  const req = {
    query,
    headers,
  } as unknown as Request;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

// Helper to get handler from router
function getHandler(
  router: ReturnType<typeof createModelsRouter>,
  method: 'get' | 'post',
  path: string
) {
  return getRouteHandler(router, method, path);
}

describe('/models routes', () => {
  let mockCache: OpenRouterModelCache;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCache = createMockModelCache();
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createModelsRouter(mockCache);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have all routes registered', () => {
      const router = createModelsRouter(mockCache);

      // Check all expected routes exist
      expect(findRoute(router, 'get', '/')).toBeDefined();
      expect(findRoute(router, 'get', '/text')).toBeDefined();
      expect(findRoute(router, 'get', '/vision')).toBeDefined();
      expect(findRoute(router, 'get', '/image-generation')).toBeDefined();
      expect(findRoute(router, 'post', '/refresh')).toBeDefined();
    });
  });

  describe('GET /models', () => {
    it('should return models list', async () => {
      const router = createModelsRouter(mockCache);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          models: sampleTextModels,
          count: 2,
        })
      );
    });

    it('should pass filter options to cache', async () => {
      const router = createModelsRouter(mockCache);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes({
        inputModality: 'image',
        outputModality: 'text',
        search: 'gpt',
        limit: '10',
      });

      await handler(req, res);

      expect(mockCache.getFilteredModels).toHaveBeenCalledWith({
        inputModality: 'image',
        outputModality: 'text',
        search: 'gpt',
        limit: 10,
      });
    });

    it('should use default limit of 25', async () => {
      const router = createModelsRouter(mockCache);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(mockCache.getFilteredModels).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 25,
        })
      );
    });

    it('should cap limit at 100', async () => {
      const router = createModelsRouter(mockCache);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes({ limit: '500' });

      await handler(req, res);

      expect(mockCache.getFilteredModels).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 100,
        })
      );
    });

    it('should reject invalid inputModality', async () => {
      const router = createModelsRouter(mockCache);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes({ inputModality: 'invalid' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('Invalid inputModality'),
        })
      );
    });

    it('should reject invalid outputModality', async () => {
      const router = createModelsRouter(mockCache);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes({ outputModality: 'invalid' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('Invalid outputModality'),
        })
      );
    });

    it('should accept valid modalities', async () => {
      const router = createModelsRouter(mockCache);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes({
        inputModality: 'image',
        outputModality: 'text',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('GET /models/text', () => {
    it('should return text generation models', async () => {
      const router = createModelsRouter(mockCache);
      const handler = getHandler(router, 'get', '/text');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(mockCache.getTextModels).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          models: sampleTextModels,
          count: 2,
        })
      );
    });

    it('should support search parameter', async () => {
      const router = createModelsRouter(mockCache);
      const handler = getHandler(router, 'get', '/text');
      const { req, res } = createMockReqRes({ search: 'claude' });

      await handler(req, res);

      expect(mockCache.getTextModels).toHaveBeenCalledWith('claude', 25);
    });

    it('should support limit parameter', async () => {
      const router = createModelsRouter(mockCache);
      const handler = getHandler(router, 'get', '/text');
      const { req, res } = createMockReqRes({ limit: '10' });

      await handler(req, res);

      expect(mockCache.getTextModels).toHaveBeenCalledWith(undefined, 10);
    });
  });

  describe('GET /models/vision', () => {
    it('should return vision-capable models', async () => {
      const router = createModelsRouter(mockCache);
      const handler = getHandler(router, 'get', '/vision');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(mockCache.getVisionModels).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          models: sampleVisionModels,
          count: 1,
        })
      );
    });
  });

  describe('GET /models/image-generation', () => {
    it('should return image generation models', async () => {
      const router = createModelsRouter(mockCache);
      const handler = getHandler(router, 'get', '/image-generation');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(mockCache.getImageGenerationModels).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          models: sampleImageGenModels,
          count: 1,
        })
      );
    });
  });

  describe('POST /models/refresh', () => {
    it('should reject non-owner users', async () => {
      const router = createModelsRouter(mockCache);
      const handler = getHandler(router, 'post', '/refresh');
      const { req, res } = createMockReqRes({}, { 'x-user-id': 'regular-user-456' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'UNAUTHORIZED',
          message: expect.stringContaining('Only bot owner'),
        })
      );
    });

    it('should reject missing user ID', async () => {
      const router = createModelsRouter(mockCache);
      const handler = getHandler(router, 'post', '/refresh');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should allow bot owner to refresh cache', async () => {
      const router = createModelsRouter(mockCache);
      const handler = getHandler(router, 'post', '/refresh');
      const { req, res } = createMockReqRes({}, { 'x-user-id': 'bot-owner-123' });

      await handler(req, res);

      expect(mockCache.refreshCache).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          modelCount: 100,
        })
      );
    });
  });
});
