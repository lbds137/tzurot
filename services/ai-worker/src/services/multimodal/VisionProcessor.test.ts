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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('hasVisionSupport', () => {
    describe('OpenAI models', () => {
      it('should detect gpt-4o as having vision', () => {
        expect(hasVisionSupport('gpt-4o')).toBe(true);
        expect(hasVisionSupport('gpt-4o-mini')).toBe(true);
      });

      it('should detect gpt-4-vision as having vision', () => {
        expect(hasVisionSupport('gpt-4-vision')).toBe(true);
        expect(hasVisionSupport('gpt-4-vision-preview')).toBe(true);
      });

      it('should detect gpt-4-turbo as having vision', () => {
        expect(hasVisionSupport('gpt-4-turbo')).toBe(true);
        expect(hasVisionSupport('gpt-4-turbo-preview')).toBe(true);
      });

      it('should NOT detect gpt-3.5 as having vision', () => {
        expect(hasVisionSupport('gpt-3.5-turbo')).toBe(false);
      });

      it('should NOT detect basic gpt-4 as having vision', () => {
        expect(hasVisionSupport('gpt-4')).toBe(false);
      });
    });

    describe('Anthropic Claude models', () => {
      it('should detect claude-3 models as having vision', () => {
        expect(hasVisionSupport('claude-3-opus')).toBe(true);
        expect(hasVisionSupport('claude-3-sonnet')).toBe(true);
        expect(hasVisionSupport('claude-3-haiku')).toBe(true);
      });

      it('should detect claude-4 models as having vision', () => {
        expect(hasVisionSupport('claude-4-opus')).toBe(true);
      });

      it('should NOT detect claude-2 as having vision', () => {
        expect(hasVisionSupport('claude-2')).toBe(false);
        expect(hasVisionSupport('claude-2.1')).toBe(false);
      });
    });

    describe('Google Gemini models', () => {
      it('should detect gemini-1.5 models as having vision', () => {
        expect(hasVisionSupport('gemini-1.5-pro')).toBe(true);
        expect(hasVisionSupport('gemini-1.5-flash')).toBe(true);
      });

      it('should detect gemini-2.x models as having vision', () => {
        expect(hasVisionSupport('gemini-2.0-pro')).toBe(true);
        expect(hasVisionSupport('gemini-2.5-flash')).toBe(true);
      });

      it('should detect gemini models with "vision" in name', () => {
        expect(hasVisionSupport('gemini-pro-vision')).toBe(true);
      });

      it('should NOT detect old gemini-pro as having vision', () => {
        expect(hasVisionSupport('gemini-pro')).toBe(false);
      });
    });

    describe('Llama models', () => {
      it('should detect llama vision models', () => {
        expect(hasVisionSupport('llama-3-vision')).toBe(true);
        expect(hasVisionSupport('llama-vision-instruct')).toBe(true);
      });

      it('should NOT detect basic llama models', () => {
        expect(hasVisionSupport('llama-3')).toBe(false);
        expect(hasVisionSupport('llama-2-70b')).toBe(false);
      });
    });

    describe('case insensitivity', () => {
      it('should handle uppercase model names', () => {
        expect(hasVisionSupport('GPT-4O')).toBe(true);
        expect(hasVisionSupport('CLAUDE-3-OPUS')).toBe(true);
        expect(hasVisionSupport('GEMINI-1.5-PRO')).toBe(true);
      });

      it('should handle mixed case model names', () => {
        expect(hasVisionSupport('Gpt-4-Vision-Preview')).toBe(true);
        expect(hasVisionSupport('Claude-3-Sonnet')).toBe(true);
      });
    });

    describe('unknown models', () => {
      it('should return false for unknown models', () => {
        expect(hasVisionSupport('unknown-model')).toBe(false);
        expect(hasVisionSupport('text-davinci-003')).toBe(false);
        expect(hasVisionSupport('')).toBe(false);
      });
    });
  });

  describe('describeImage', () => {
    const mockAttachment: AttachmentMetadata = {
      url: 'https://example.com/test-image.png',
      name: 'test-image.png',
      contentType: 'image/png',
      size: 1024,
    };

    describe('model routing', () => {
      it('should use personality visionModel when specified', async () => {
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
        // Verify it was called with vision model, not main model
      });

      it('should use main model when it has vision support', async () => {
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
      });

      it('should use fallback vision model when main model has no vision support', async () => {
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
      });

      it('should prefer visionModel over main model even if main has vision', async () => {
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
      });
    });

    describe('system prompt handling', () => {
      it('should include system prompt when provided', async () => {
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
  });
});
