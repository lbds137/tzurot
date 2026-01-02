/**
 * Tests for Vision Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasVisionSupport, describeImage } from './VisionProcessor.js';
import type { AttachmentMetadata, LoadedPersonality } from '@tzurot/common-types';

// Create mock functions
const mockChatOpenAIInvoke = vi.fn().mockResolvedValue({
  content: 'Mocked image description',
});

// Mock the checkModelVisionSupport function from redis.ts
const mockCheckModelVisionSupport = vi.fn();

// Mock the visionDescriptionCache from redis.ts
const mockVisionCacheGet = vi.fn().mockResolvedValue(null); // Default: cache miss
const mockVisionCacheStore = vi.fn().mockResolvedValue(undefined);

vi.mock('../../redis.js', () => ({
  checkModelVisionSupport: (modelId: string) => mockCheckModelVisionSupport(modelId),
  visionDescriptionCache: {
    get: (options: { attachmentId?: string; url: string }) => mockVisionCacheGet(options),
    store: (options: { attachmentId?: string; url: string; model?: string }, description: string) =>
      mockVisionCacheStore(options, description),
  },
}));

// Mock dependencies
vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class MockChatOpenAI {
    constructor(public config: any) {}
    invoke = mockChatOpenAIInvoke;
  },
}));

describe('VisionProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatOpenAIInvoke.mockResolvedValue({
      content: 'Mocked image description',
    });
    // Default mock behavior - return false unless specified
    mockCheckModelVisionSupport.mockResolvedValue(false);
    // Default cache behavior - miss (null)
    mockVisionCacheGet.mockResolvedValue(null);
    mockVisionCacheStore.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('hasVisionSupport', () => {
    /**
     * Note: hasVisionSupport is now an async function that delegates to
     * ModelCapabilityChecker.modelSupportsVision() which queries Redis.
     *
     * The comprehensive capability detection tests are in ModelCapabilityChecker.test.ts.
     * These tests verify the async wrapper works correctly.
     */
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
        // visionModel takes priority, so capability check not needed
        const personality: LoadedPersonality = {
          id: 'test',
          name: 'Test',
          slug: 'test',
          systemPrompt: 'Test prompt',
          model: 'gpt-4', // No vision support
          visionModel: 'gpt-4-vision-preview', // Override with vision model
          temperature: 0.7,
          maxTokens: 1000,
        };

        await describeImage(mockAttachment, personality);

        expect(mockChatOpenAIInvoke).toHaveBeenCalledTimes(1);
        // Should not check capability when visionModel is specified
        expect(mockCheckModelVisionSupport).not.toHaveBeenCalled();
      });

      it('should use main model when it has vision support', async () => {
        // Mock gpt-4o as having vision support
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality: LoadedPersonality = {
          id: 'test',
          name: 'Test',
          slug: 'test',
          systemPrompt: 'Test prompt',
          model: 'gpt-4o', // Has vision support
          visionModel: null,
          temperature: 0.7,
          maxTokens: 1000,
        };

        await describeImage(mockAttachment, personality);

        expect(mockChatOpenAIInvoke).toHaveBeenCalledTimes(1);
        expect(mockCheckModelVisionSupport).toHaveBeenCalledWith('gpt-4o');
      });

      it('should use fallback vision model when main model has no vision support', async () => {
        // Mock gpt-4 as NOT having vision support
        mockCheckModelVisionSupport.mockResolvedValue(false);

        const personality: LoadedPersonality = {
          id: 'test',
          name: 'Test',
          slug: 'test',
          systemPrompt: 'Test prompt',
          model: 'gpt-4', // No vision support
          visionModel: null,
          temperature: 0.7,
          maxTokens: 1000,
        };

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe('Mocked image description');
        expect(mockChatOpenAIInvoke).toHaveBeenCalledTimes(1);
        expect(mockCheckModelVisionSupport).toHaveBeenCalledWith('gpt-4');
      });

      it('should prefer visionModel over main model even if main has vision', async () => {
        // visionModel takes priority, capability check not needed
        const personality: LoadedPersonality = {
          id: 'test',
          name: 'Test',
          slug: 'test',
          systemPrompt: 'Test prompt',
          model: 'gpt-4o', // Has vision
          visionModel: 'claude-3-opus', // But prefer this
          temperature: 0.7,
          maxTokens: 1000,
        };

        await describeImage(mockAttachment, personality);

        expect(mockChatOpenAIInvoke).toHaveBeenCalledTimes(1);
        // Should not check capability when visionModel is specified
        expect(mockCheckModelVisionSupport).not.toHaveBeenCalled();
      });
    });

    describe('system prompt handling', () => {
      it('should include system prompt when provided', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality: LoadedPersonality = {
          id: 'test',
          name: 'Test',
          slug: 'test',
          systemPrompt: 'You are a helpful assistant',
          model: 'gpt-4o',
          visionModel: null,
          temperature: 0.7,
          maxTokens: 1000,
        };

        await describeImage(mockAttachment, personality);

        const messages = mockChatOpenAIInvoke.mock.calls[0][0];
        expect(messages[0]).toMatchObject({
          content: 'You are a helpful assistant',
        });
      });

      it('should work without system prompt', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality: LoadedPersonality = {
          id: 'test',
          name: 'Test',
          slug: 'test',
          systemPrompt: '',
          model: 'gpt-4o',
          visionModel: null,
          temperature: 0.7,
          maxTokens: 1000,
        };

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe('Mocked image description');
      });

      it('should handle undefined system prompt', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality: LoadedPersonality = {
          id: 'test',
          name: 'Test',
          slug: 'test',
          systemPrompt: undefined as any,
          model: 'gpt-4o',
          visionModel: null,
          temperature: 0.7,
          maxTokens: 1000,
        };

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe('Mocked image description');
      });
    });

    describe('error handling', () => {
      it('should propagate vision model errors', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality: LoadedPersonality = {
          id: 'test',
          name: 'Test',
          slug: 'test',
          systemPrompt: 'Test',
          model: 'gpt-4o',
          visionModel: null,
          temperature: 0.7,
          maxTokens: 1000,
        };

        mockChatOpenAIInvoke.mockRejectedValue(new Error('Vision API error'));

        await expect(describeImage(mockAttachment, personality)).rejects.toThrow(
          'Vision API error'
        );
      });

      it('should propagate fallback vision model errors', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(false);

        const personality: LoadedPersonality = {
          id: 'test',
          name: 'Test',
          slug: 'test',
          systemPrompt: 'Test',
          model: 'gpt-4', // No vision
          visionModel: null,
          temperature: 0.7,
          maxTokens: 1000,
        };

        mockChatOpenAIInvoke.mockRejectedValue(new Error('Fallback API error'));

        await expect(describeImage(mockAttachment, personality)).rejects.toThrow(
          'Fallback API error'
        );
      });

      it('should handle non-string response content', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality: LoadedPersonality = {
          id: 'test',
          name: 'Test',
          slug: 'test',
          systemPrompt: 'Test',
          model: 'gpt-4o',
          visionModel: null,
          temperature: 0.7,
          maxTokens: 1000,
        };

        mockChatOpenAIInvoke.mockResolvedValue({
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

        const personality: LoadedPersonality = {
          id: 'test',
          name: 'Test',
          slug: 'test',
          systemPrompt: 'Test',
          model: 'gpt-4o',
          visionModel: null,
          temperature: 0.7,
          maxTokens: 1000,
        };

        await describeImage(mockAttachment, personality);

        const messages = mockChatOpenAIInvoke.mock.calls[0][0];
        const humanMessage = messages[messages.length - 1];
        const imageContent = humanMessage.content.find((c: any) => c.type === 'image_url');

        expect(imageContent.image_url.url).toBe(mockAttachment.url);
      });

      it('should include description prompt', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality: LoadedPersonality = {
          id: 'test',
          name: 'Test',
          slug: 'test',
          systemPrompt: 'Test',
          model: 'gpt-4o',
          visionModel: null,
          temperature: 0.7,
          maxTokens: 1000,
        };

        await describeImage(mockAttachment, personality);

        const messages = mockChatOpenAIInvoke.mock.calls[0][0];
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

        const personality: LoadedPersonality = {
          id: 'test',
          name: 'Test',
          slug: 'test',
          systemPrompt: 'Test',
          model: 'gpt-4o',
          visionModel: null,
          temperature: 0.7,
          maxTokens: 1000,
        };

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe(cachedDescription);
        expect(mockVisionCacheGet).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
        });
        // Should NOT call the vision API
        expect(mockChatOpenAIInvoke).not.toHaveBeenCalled();
        // Should NOT store in cache (already cached)
        expect(mockVisionCacheStore).not.toHaveBeenCalled();
      });

      it('should call vision API and cache result on cache miss', async () => {
        mockVisionCacheGet.mockResolvedValue(null); // Cache miss
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality: LoadedPersonality = {
          id: 'test',
          name: 'Test',
          slug: 'test',
          systemPrompt: 'Test',
          model: 'gpt-4o',
          visionModel: null,
          temperature: 0.7,
          maxTokens: 1000,
        };

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe('Mocked image description');
        expect(mockVisionCacheGet).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
        });
        expect(mockChatOpenAIInvoke).toHaveBeenCalledTimes(1);
        expect(mockVisionCacheStore).toHaveBeenCalledWith(
          { attachmentId: mockAttachment.id, url: mockAttachment.url, model: 'gpt-4o' },
          'Mocked image description'
        );
      });

      it('should not cache on vision API error', async () => {
        mockVisionCacheGet.mockResolvedValue(null);
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockChatOpenAIInvoke.mockRejectedValue(new Error('Vision API error'));

        const personality: LoadedPersonality = {
          id: 'test',
          name: 'Test',
          slug: 'test',
          systemPrompt: 'Test',
          model: 'gpt-4o',
          visionModel: null,
          temperature: 0.7,
          maxTokens: 1000,
        };

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
  });
});
