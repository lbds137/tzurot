/**
 * Tests for Vision Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasVisionSupport, describeImage } from './VisionProcessor.js';
import type { AttachmentMetadata, LoadedPersonality } from '@tzurot/common-types';
import { AI_DEFAULTS } from '@tzurot/common-types';

/**
 * Factory function to create a mock LoadedPersonality with sensible defaults.
 */
function createMockPersonality(overrides: Partial<LoadedPersonality> = {}): LoadedPersonality {
  return {
    id: 'test',
    name: 'Test',
    displayName: 'Test',
    slug: 'test',
    systemPrompt: 'Test prompt',
    model: 'gpt-4',
    visionModel: undefined,
    temperature: 0.7,
    maxTokens: 1000,
    contextWindowTokens: 8000,
    characterInfo: '',
    personalityTraits: '',
    ...overrides,
  } as LoadedPersonality;
}

// Create mock functions
const mockModelInvoke = vi.fn().mockResolvedValue({
  content: 'Mocked image description',
});

const mockCreateChatModel = vi.fn().mockReturnValue({
  model: { invoke: mockModelInvoke },
  modelName: 'test-model',
});

// Mock the checkModelVisionSupport function from redis.ts
const mockCheckModelVisionSupport = vi.fn();

// Mock the visionDescriptionCache from redis.ts
const mockVisionCacheGet = vi.fn().mockResolvedValue(null); // Default: cache miss
const mockVisionCacheStore = vi.fn().mockResolvedValue(undefined);
const mockVisionCacheGetFailure = vi.fn().mockResolvedValue(null); // Default: no failure cached
const mockVisionCacheStoreFailure = vi.fn().mockResolvedValue(undefined);

vi.mock('../../redis.js', () => ({
  checkModelVisionSupport: (modelId: string) => mockCheckModelVisionSupport(modelId),
  visionDescriptionCache: {
    get: (options: { attachmentId?: string; url: string }) => mockVisionCacheGet(options),
    store: (options: { attachmentId?: string; url: string; model?: string }, description: string) =>
      mockVisionCacheStore(options, description),
    getFailure: (options: { attachmentId?: string; url: string }) =>
      mockVisionCacheGetFailure(options),
    storeFailure: (options: {
      attachmentId?: string;
      url: string;
      category: string;
      permanent: boolean;
    }) => mockVisionCacheStoreFailure(options),
  },
}));

// Mock ModelFactory
vi.mock('../ModelFactory.js', () => ({
  createChatModel: (...args: unknown[]) => mockCreateChatModel(...args),
}));

// Mock apiErrorParser
vi.mock('../../utils/apiErrorParser.js', () => ({
  parseApiError: (error: unknown) => ({
    category: 'transient',
    type: 'UNKNOWN',
    statusCode: undefined,
    shouldRetry: true,
    technicalMessage: error instanceof Error ? error.message : String(error),
    referenceId: 'test-ref',
    requestId: undefined,
  }),
}));

describe('VisionProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelInvoke.mockResolvedValue({
      content: 'Mocked image description',
    });
    mockCreateChatModel.mockReturnValue({
      model: { invoke: mockModelInvoke },
      modelName: 'test-model',
    });
    // Default mock behavior - return false unless specified
    mockCheckModelVisionSupport.mockResolvedValue(false);
    // Default cache behavior - miss (null)
    mockVisionCacheGet.mockResolvedValue(null);
    mockVisionCacheStore.mockResolvedValue(undefined);
    // Default failure cache behavior - no failure cached
    mockVisionCacheGetFailure.mockResolvedValue(null);
    mockVisionCacheStoreFailure.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('hasVisionSupport', () => {
    it('should return true when model supports vision', async () => {
      mockCheckModelVisionSupport.mockResolvedValue(true);
      expect(await hasVisionSupport('gpt-4o')).toBe(true);
      expect(mockCheckModelVisionSupport).toHaveBeenCalledWith('gpt-4o');
    });

    it('should return false when model does not support vision', async () => {
      mockCheckModelVisionSupport.mockResolvedValue(false);
      expect(await hasVisionSupport('gpt-3.5-turbo')).toBe(false);
      expect(mockCheckModelVisionSupport).toHaveBeenCalledWith('gpt-3.5-turbo');
    });

    it('should delegate to checkModelVisionSupport for capability detection', async () => {
      mockCheckModelVisionSupport.mockResolvedValue(true);
      await hasVisionSupport('google/gemma-3-27b-it:free');
      expect(mockCheckModelVisionSupport).toHaveBeenCalledWith('google/gemma-3-27b-it:free');
    });
  });

  describe('describeImage', () => {
    const mockAttachment: AttachmentMetadata = {
      id: '123456789012345678',
      url: 'https://example.com/test-image.png',
      name: 'test-image.png',
      contentType: 'image/png',
      size: 1024,
    };

    describe('model routing', () => {
      it('should use personality visionModel when specified', async () => {
        const personality = createMockPersonality({
          model: 'gpt-4',
          visionModel: 'gpt-4-vision-preview',
        });

        await describeImage(mockAttachment, personality);

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            modelName: 'gpt-4-vision-preview',
          })
        );
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
        expect(mockCheckModelVisionSupport).not.toHaveBeenCalled();
      });

      it('should use main model when it has vision support', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality);

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            modelName: 'gpt-4o',
          })
        );
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
        expect(mockCheckModelVisionSupport).toHaveBeenCalledWith('gpt-4o');
      });

      it('should use fallback vision model when main model has no vision support', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(false);

        const personality = createMockPersonality({
          model: 'gpt-4',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe('Mocked image description');
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
        expect(mockCheckModelVisionSupport).toHaveBeenCalledWith('gpt-4');
      });

      it('should prefer visionModel over main model even if main has vision', async () => {
        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: 'claude-3-opus',
        });

        await describeImage(mockAttachment, personality);

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            modelName: 'claude-3-opus',
          })
        );
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
        expect(mockCheckModelVisionSupport).not.toHaveBeenCalled();
      });
    });

    describe('createChatModel configuration', () => {
      it('should pass VISION_TEMPERATURE to createChatModel', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality);

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: AI_DEFAULTS.VISION_TEMPERATURE,
          })
        );
      });

      it('should pass user API key to createChatModel', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality, false, 'user-api-key-123');

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            apiKey: 'user-api-key-123',
          })
        );
      });

      it('should not pass apiKey when userApiKey is undefined', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality, false, undefined);

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            apiKey: undefined,
          })
        );
      });
    });

    describe('system prompt handling', () => {
      it('should include system prompt when provided', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
          systemPrompt: 'You are a helpful assistant',
        });

        await describeImage(mockAttachment, personality);

        const messages = mockModelInvoke.mock.calls[0][0];
        expect(messages[0]).toMatchObject({
          content: 'You are a helpful assistant',
        });
      });

      it('should work without system prompt', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
          systemPrompt: '',
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe('Mocked image description');
      });

      it('should handle undefined system prompt', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
          systemPrompt: undefined as any,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe('Mocked image description');
      });
    });

    describe('error handling', () => {
      it('should propagate vision model errors', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        mockModelInvoke.mockRejectedValue(new Error('Vision API error'));

        await expect(describeImage(mockAttachment, personality)).rejects.toThrow(
          'Vision API error'
        );
      });

      it('should propagate fallback vision model errors', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(false);

        const personality = createMockPersonality({
          model: 'gpt-4',
          visionModel: undefined,
        });

        mockModelInvoke.mockRejectedValue(new Error('Fallback API error'));

        await expect(describeImage(mockAttachment, personality)).rejects.toThrow(
          'Fallback API error'
        );
      });

      it('should handle non-string response content', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        mockModelInvoke.mockResolvedValue({
          content: [{ type: 'text', text: 'Complex response' }],
        });

        const result = await describeImage(mockAttachment, personality);

        // Should stringify non-string content
        expect(typeof result).toBe('string');
      });
    });

    describe('attachment handling', () => {
      it('should use attachment URL correctly', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality);

        const messages = mockModelInvoke.mock.calls[0][0];
        const humanMessage = messages[messages.length - 1];
        const imageContent = humanMessage.content.find((c: any) => c.type === 'image_url');

        expect(imageContent.image_url.url).toBe(mockAttachment.url);
      });

      it('should include description prompt', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality);

        const messages = mockModelInvoke.mock.calls[0][0];
        const humanMessage = messages[messages.length - 1];
        const textContent = humanMessage.content.find((c: any) => c.type === 'text');

        expect(textContent.text).toContain('detailed');
        expect(textContent.text).toContain('objective description');
      });
    });

    describe('caching', () => {
      it('should return cached description on cache hit', async () => {
        const cachedDescription = 'Previously cached image description';
        mockVisionCacheGet.mockResolvedValue(cachedDescription);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe(cachedDescription);
        expect(mockVisionCacheGet).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
        });
        // Should NOT call the vision API
        expect(mockModelInvoke).not.toHaveBeenCalled();
        // Should NOT store in cache (already cached)
        expect(mockVisionCacheStore).not.toHaveBeenCalled();
      });

      it('should call vision API and cache result on cache miss', async () => {
        mockVisionCacheGet.mockResolvedValue(null); // Cache miss
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe('Mocked image description');
        expect(mockVisionCacheGet).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
        });
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
        expect(mockVisionCacheStore).toHaveBeenCalledWith(
          { attachmentId: mockAttachment.id, url: mockAttachment.url, model: 'gpt-4o' },
          'Mocked image description'
        );
      });

      it('should not cache on vision API error', async () => {
        mockVisionCacheGet.mockResolvedValue(null);
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockModelInvoke.mockRejectedValue(new Error('Vision API error'));

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await expect(describeImage(mockAttachment, personality)).rejects.toThrow(
          'Vision API error'
        );

        // Should have checked cache
        expect(mockVisionCacheGet).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
        });
        // Should NOT have stored anything (API failed)
        expect(mockVisionCacheStore).not.toHaveBeenCalled();
      });
    });

    describe('negative caching (failure cache)', () => {
      it('should return permanent failure fallback when failure is cached', async () => {
        mockVisionCacheGetFailure.mockResolvedValue({
          category: 'authentication',
          permanent: true,
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe('[Image unavailable: authentication]');
        expect(mockModelInvoke).not.toHaveBeenCalled();
        expect(mockVisionCacheStore).not.toHaveBeenCalled();
      });

      it('should return transient failure fallback when cooldown is active', async () => {
        mockVisionCacheGetFailure.mockResolvedValue({
          category: 'rate_limit',
          permanent: false,
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe('[Image temporarily unavailable]');
        expect(mockModelInvoke).not.toHaveBeenCalled();
      });

      it('should check failure cache after success cache miss', async () => {
        mockVisionCacheGet.mockResolvedValue(null);
        mockVisionCacheGetFailure.mockResolvedValue(null);
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality);

        expect(mockVisionCacheGet).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
        });
        expect(mockVisionCacheGetFailure).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
        });
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
      });

      it('should store failure in negative cache on vision API error', async () => {
        mockVisionCacheGet.mockResolvedValue(null);
        mockVisionCacheGetFailure.mockResolvedValue(null);
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockModelInvoke.mockRejectedValue(new Error('Vision API error'));

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await expect(describeImage(mockAttachment, personality)).rejects.toThrow(
          'Vision API error'
        );

        expect(mockVisionCacheStoreFailure).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
          category: 'transient',
          permanent: false,
        });
      });

      it('should skip failure cache when success cache hits', async () => {
        mockVisionCacheGet.mockResolvedValue('Cached description');

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality);

        // Should NOT check failure cache - success cache already returned
        expect(mockVisionCacheGetFailure).not.toHaveBeenCalled();
      });
    });
  });
});
