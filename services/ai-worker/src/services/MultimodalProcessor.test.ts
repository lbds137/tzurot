/**
 * Tests for Multimodal Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { describeImage, transcribeAudio, processAttachments } from './MultimodalProcessor.js';
import type { AttachmentMetadata, LoadedPersonality } from '@tzurot/common-types';
import { AttachmentType, CONTENT_TYPES } from '@tzurot/common-types';

// Use vi.hoisted() to create mocks that persist across test resets
const {
  mockChatOpenAIInvoke,
  mockWhisperCreate,
  mockGetVoiceTranscript,
  mockCheckModelVisionSupport,
  mockVisionCacheGet,
  mockVisionCacheStore,
} = vi.hoisted(() => ({
  mockChatOpenAIInvoke: vi.fn(),
  mockWhisperCreate: vi.fn(),
  mockGetVoiceTranscript: vi.fn(),
  mockCheckModelVisionSupport: vi.fn(),
  mockVisionCacheGet: vi.fn(),
  mockVisionCacheStore: vi.fn(),
}));

// Mock dependencies
vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class MockChatOpenAI {
    invoke = mockChatOpenAIInvoke;
  },
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    audio = {
      transcriptions: {
        create: mockWhisperCreate,
      },
    };
  },
}));

// Mock fetch for audio downloads
global.fetch = vi.fn();

// Mock redis module (transcribeAudio tries to import it, VisionProcessor uses checkModelVisionSupport and visionDescriptionCache)
vi.mock('../redis.js', () => ({
  getVoiceTranscript: mockGetVoiceTranscript,
  checkModelVisionSupport: mockCheckModelVisionSupport,
  visionDescriptionCache: {
    get: mockVisionCacheGet,
    store: mockVisionCacheStore,
  },
}));

describe('MultimodalProcessor', () => {
  const mockPersonality: LoadedPersonality = {
    id: 'test-personality',
    name: 'Test',
    slug: 'test',
    systemPrompt: 'Test prompt',
    model: 'gpt-4-vision-preview',
    visionModel: 'gpt-4-vision-preview',
    temperature: 0.7,
    maxTokens: 1000,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock implementations to default
    mockChatOpenAIInvoke.mockResolvedValue({
      content: 'Mocked image description',
    });

    // Whisper with response_format:'text' returns string directly, not {text: string}
    mockWhisperCreate.mockResolvedValue('Mocked transcription');

    // Reset redis mocks to default
    mockGetVoiceTranscript.mockResolvedValue(null); // Return null to skip cache
    mockCheckModelVisionSupport.mockResolvedValue(false); // Default to no vision support
    mockVisionCacheGet.mockResolvedValue(null); // Default: cache miss
    mockVisionCacheStore.mockResolvedValue(undefined);

    // Don't reset fetch - let tests set it up themselves
    // (global.fetch as any).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('describeImage', () => {
    it('should describe an image successfully', async () => {
      const imageUrl = 'https://example.com/image.png';

      const result = await describeImage(imageUrl, mockPersonality);

      expect(result).toBe('Mocked image description');
    });

    it('should use fallback vision model when personality has no vision model', async () => {
      const personalityNoVision: LoadedPersonality = {
        ...mockPersonality,
        visionModel: null,
        model: 'gpt-4', // Model without vision support
      };

      const result = await describeImage('https://example.com/image.png', personalityNoVision);

      // Should use fallback vision model and return description
      expect(result).toBe('Mocked image description');
      expect(typeof result).toBe('string');
    });

    it('should handle vision model errors gracefully', async () => {
      mockChatOpenAIInvoke.mockRejectedValue(new Error('Vision API error'));

      await expect(describeImage('https://example.com/image.png', mockPersonality)).rejects.toThrow(
        'Vision API error'
      );
    });
  });

  describe('transcribeAudio', () => {
    it('should transcribe audio successfully', async () => {
      const attachment: AttachmentMetadata = {
        url: 'https://example.com/audio.ogg',
        name: 'audio.ogg',
        contentType: CONTENT_TYPES.AUDIO_OGG,
        size: 1024,
      };

      // Mock successful fetch
      (global.fetch as any).mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
      });

      const result = await transcribeAudio(attachment, mockPersonality);

      expect(result).toBe('Mocked transcription');
      expect(global.fetch).toHaveBeenCalledWith(attachment.url, expect.any(Object));
    });

    it('should handle fetch errors', async () => {
      const attachment: AttachmentMetadata = {
        url: 'https://example.com/audio.ogg',
        name: 'audio.ogg',
        contentType: CONTENT_TYPES.AUDIO_OGG,
        size: 1024,
      };

      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      await expect(transcribeAudio(attachment, mockPersonality)).rejects.toThrow('Network error');
    });

    it('should handle Whisper API errors', async () => {
      const attachment: AttachmentMetadata = {
        url: 'https://example.com/audio.ogg',
        name: 'audio.ogg',
        contentType: CONTENT_TYPES.AUDIO_OGG,
        size: 1024,
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      });

      mockWhisperCreate.mockRejectedValue(new Error('Whisper API error'));

      await expect(transcribeAudio(attachment, mockPersonality)).rejects.toThrow(
        'Whisper API error'
      );
    });
  });

  describe('processAttachments', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should process single image attachment successfully', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/image1.png',
          name: 'image1.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      const promise = processAttachments(attachments, mockPersonality);

      // Fast-forward timers for any potential retries
      await vi.runAllTimersAsync();

      const results = await promise;

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        type: AttachmentType.Image,
        description: 'Mocked image description',
        originalUrl: 'https://example.com/image1.png',
      });
    });

    it('should process single audio attachment successfully', async () => {
      // Use real timers for this test - we're not testing timeout logic
      vi.useRealTimers();

      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/audio1.ogg',
          name: 'audio1.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 2048,
        },
      ];

      // Ensure fetch is properly mocked
      (global.fetch as any).mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(2048)),
      });

      const results = await processAttachments(attachments, mockPersonality);

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe(AttachmentType.Audio);
      expect(results[0].originalUrl).toBe('https://example.com/audio1.ogg');
      // Note: Audio transcription is tested directly in transcribeAudio tests
      // This test focuses on processAttachments handling audio attachments

      // Restore fake timers for subsequent tests
      vi.useFakeTimers();
    });

    it('should process multiple attachments in parallel', async () => {
      // Use real timers for this test - we're not testing timeout logic
      vi.useRealTimers();

      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/image1.png',
          name: 'image1.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
        {
          url: 'https://example.com/image2.png',
          name: 'image2.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
        {
          url: 'https://example.com/audio1.ogg',
          name: 'audio1.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 2048,
        },
      ];

      (global.fetch as any).mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(2048)),
      });

      const results = await processAttachments(attachments, mockPersonality);

      expect(results).toHaveLength(3);
      expect(results[0].type).toBe(AttachmentType.Image);
      expect(results[1].type).toBe(AttachmentType.Image);
      expect(results[2].type).toBe(AttachmentType.Audio);
      // Note: Specific audio/image descriptions are tested in their direct function tests
      // This test focuses on parallel processing of mixed attachment types

      // Restore fake timers for subsequent tests
      vi.useFakeTimers();
    });

    it('should retry failed attachments and eventually succeed', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/image1.png',
          name: 'image1.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      mockChatOpenAIInvoke
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce({ content: 'Success after retries' });

      const promise = processAttachments(attachments, mockPersonality);

      // Fast-forward through retry delays
      await vi.runAllTimersAsync();

      const results = await promise;

      expect(results).toHaveLength(1);
      expect(results[0].description).toBe('Success after retries');
      expect(mockChatOpenAIInvoke).toHaveBeenCalledTimes(3);
    });

    it('should provide fallback description for permanently failed attachments', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/image1.png',
          name: 'image1.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      mockChatOpenAIInvoke.mockRejectedValue(new Error('Permanent failure'));

      const promise = processAttachments(attachments, mockPersonality);

      // Fast-forward through all retry attempts
      await vi.runAllTimersAsync();

      const results = await promise;

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        type: AttachmentType.Image,
        description: 'Image processing failed after 3 attempts',
        originalUrl: 'https://example.com/image1.png',
      });
      expect(mockChatOpenAIInvoke).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed success and failure in parallel processing', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/image1.png',
          name: 'image1.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
        {
          url: 'https://example.com/image2.png',
          name: 'image2.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      let callCount = 0;
      mockChatOpenAIInvoke.mockImplementation((messages: any) => {
        callCount++;
        // Extract URL from the message content to identify which attachment
        const imageUrl = messages[messages.length - 1]?.content?.find(
          (c: any) => c.type === 'image_url'
        )?.image_url?.url;

        // First attachment (image1.png) succeeds immediately
        // Second attachment (image2.png) fails all attempts
        if (imageUrl?.includes('image1.png')) {
          return Promise.resolve({ content: 'Success' });
        } else {
          return Promise.reject(new Error('Permanent failure'));
        }
      });

      const promise = processAttachments(attachments, mockPersonality);

      await vi.runAllTimersAsync();

      const results = await promise;

      expect(results).toHaveLength(2);
      expect(results[0].description).toBe('Success');
      expect(results[1].description).toBe('Image processing failed after 3 attempts');
    });

    it('should handle audio attachment failures with appropriate fallback', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/audio1.ogg',
          name: 'audio1.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 2048,
        },
      ];

      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const promise = processAttachments(attachments, mockPersonality);

      await vi.runAllTimersAsync();

      const results = await promise;

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        type: AttachmentType.Audio,
        description: 'Audio transcription failed after 3 attempts',
        originalUrl: 'https://example.com/audio1.ogg',
      });
    });

    it('should process empty attachment array', async () => {
      const attachments: AttachmentMetadata[] = [];

      const results = await processAttachments(attachments, mockPersonality);

      expect(results).toHaveLength(0);
    });
  });
});
