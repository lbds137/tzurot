/**
 * Tests for Multimodal Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { describeImage, transcribeAudio, processAttachments } from './MultimodalProcessor.js';
import type { AttachmentMetadata, LoadedPersonality } from '@tzurot/common-types';
import { AttachmentType, CONTENT_TYPES } from '@tzurot/common-types';

// Use vi.hoisted() to create mocks that persist across test resets
const {
  mockModelInvoke,
  mockCreateChatModel,
  mockWhisperCreate,
  mockGetVoiceTranscript,
  mockCheckModelVisionSupport,
  mockVisionCacheGet,
  mockVisionCacheStore,
  mockVisionCacheGetFailure,
  mockVisionCacheStoreFailure,
} = vi.hoisted(() => ({
  mockModelInvoke: vi.fn(),
  mockCreateChatModel: vi.fn(),
  mockWhisperCreate: vi.fn(),
  mockGetVoiceTranscript: vi.fn(),
  mockCheckModelVisionSupport: vi.fn(),
  mockVisionCacheGet: vi.fn(),
  mockVisionCacheStore: vi.fn(),
  mockVisionCacheGetFailure: vi.fn(),
  mockVisionCacheStoreFailure: vi.fn(),
}));

// Mock ModelFactory (used by VisionProcessor)
vi.mock('./multimodal/../ModelFactory.js', () => ({
  createChatModel: (...args: unknown[]) => mockCreateChatModel(...args),
}));

// Mock apiErrorParser (used by VisionProcessor and MultimodalProcessor)
vi.mock('../utils/apiErrorParser.js', () => ({
  parseApiError: (error: unknown) => ({
    category: 'transient',
    type: 'UNKNOWN',
    statusCode: undefined,
    shouldRetry: true,
    technicalMessage: error instanceof Error ? error.message : String(error),
    referenceId: 'test-ref',
    requestId: undefined,
  }),
  shouldRetryError: () => true,
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
    getFailure: mockVisionCacheGetFailure,
    storeFailure: mockVisionCacheStoreFailure,
  },
}));

describe('MultimodalProcessor', () => {
  const mockPersonality: LoadedPersonality = {
    id: 'test-personality',
    name: 'Test',
    displayName: 'Test Bot',
    slug: 'test',
    systemPrompt: 'Test prompt',
    model: 'gpt-4-vision-preview',
    visionModel: 'gpt-4-vision-preview',
    temperature: 0.7,
    maxTokens: 1000,
    contextWindowTokens: 8000,
    characterInfo: 'A test personality',
    personalityTraits: 'Helpful',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock implementations to default
    mockModelInvoke.mockResolvedValue({
      content: 'Mocked image description',
    });

    mockCreateChatModel.mockReturnValue({
      model: { invoke: mockModelInvoke },
      modelName: 'test-model',
    });

    // Whisper with response_format:'text' returns string directly, not {text: string}
    mockWhisperCreate.mockResolvedValue('Mocked transcription');

    // Reset redis mocks to default
    mockGetVoiceTranscript.mockResolvedValue(null); // Return null to skip cache
    mockCheckModelVisionSupport.mockResolvedValue(false); // Default to no vision support
    mockVisionCacheGet.mockResolvedValue(null); // Default: cache miss
    mockVisionCacheStore.mockResolvedValue(undefined);
    mockVisionCacheGetFailure.mockResolvedValue(null); // Default: no failure cached
    mockVisionCacheStoreFailure.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('describeImage', () => {
    const mockAttachment = {
      url: 'https://example.com/image.png',
      contentType: 'image/png',
      name: 'image.png',
    };

    it('should describe an image successfully', async () => {
      const result = await describeImage(mockAttachment, mockPersonality);

      expect(result).toBe('Mocked image description');
    });

    it('should use fallback vision model when personality has no vision model', async () => {
      const personalityNoVision: LoadedPersonality = {
        ...mockPersonality,
        visionModel: undefined,
        model: 'gpt-4', // Model without vision support
      };

      const result = await describeImage(mockAttachment, personalityNoVision);

      // Should use fallback vision model and return description
      expect(result).toBe('Mocked image description');
      expect(typeof result).toBe('string');
    });

    it('should handle vision model errors gracefully', async () => {
      mockModelInvoke.mockRejectedValue(new Error('Vision API error'));

      await expect(describeImage(mockAttachment, mockPersonality)).rejects.toThrow(
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

      mockModelInvoke
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce({ content: 'Success after retries' });

      const promise = processAttachments(attachments, mockPersonality);

      // Fast-forward through retry delays
      await vi.runAllTimersAsync();

      const results = await promise;

      expect(results).toHaveLength(1);
      expect(results[0].description).toBe('Success after retries');
      expect(mockModelInvoke).toHaveBeenCalledTimes(3);
    });

    it('should provide fallback description with error category for permanently failed attachments', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/image1.png',
          name: 'image1.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      mockModelInvoke.mockRejectedValue(new Error('Permanent failure'));

      const promise = processAttachments(attachments, mockPersonality);

      // Fast-forward through all retry attempts
      await vi.runAllTimersAsync();

      const results = await promise;

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        type: AttachmentType.Image,
        originalUrl: 'https://example.com/image1.png',
      });
      // Fallback now includes attempt count and error category
      expect(results[0].description).toMatch(/Image processing failed after \d+ attempts \(/);
      expect(results[0].description).toContain('transient');
      expect(mockModelInvoke).toHaveBeenCalledTimes(3);
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

      mockModelInvoke.mockImplementation((messages: any) => {
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
      // Fallback includes error category
      expect(results[1].description).toMatch(/Image processing failed after \d+ attempts \(/);
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
        originalUrl: 'https://example.com/audio1.ogg',
      });
      // Fallback includes error category
      expect(results[0].description).toMatch(/Audio transcription failed after \d+ attempts \(/);
    });

    it('should process empty attachment array', async () => {
      const attachments: AttachmentMetadata[] = [];

      const results = await processAttachments(attachments, mockPersonality);

      expect(results).toHaveLength(0);
    });
  });

  describe('skipNegativeCache passthrough', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should skip negative cache during processAttachments retries', async () => {
      // Set up a transient failure in the negative cache
      mockVisionCacheGetFailure.mockResolvedValue({
        category: 'rate_limit',
        permanent: false,
      });

      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/image.png',
          name: 'image.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      const promise = processAttachments(attachments, mockPersonality);
      await vi.runAllTimersAsync();
      const results = await promise;

      // With skipNegativeCache: true, the negative cache should NOT prevent the API call
      expect(results).toHaveLength(1);
      expect(results[0].description).toBe('Mocked image description');
      expect(mockModelInvoke).toHaveBeenCalled();
    });
  });

  describe('BYOK API key integration', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockCreateChatModel.mockClear();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should pass userApiKey to createChatModel for image processing', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/image.png',
          name: 'image.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      const userApiKey = 'user-test-key-12345';
      const promise = processAttachments(attachments, mockPersonality, false, userApiKey);

      await vi.runAllTimersAsync();
      await promise;

      // Verify createChatModel was called with the user's API key
      expect(mockCreateChatModel).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: userApiKey,
        })
      );
    });

    it('should use system key when userApiKey is undefined', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/image.png',
          name: 'image.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      const promise = processAttachments(attachments, mockPersonality, false, undefined);

      await vi.runAllTimersAsync();
      await promise;

      // Verify createChatModel was called (with undefined apiKey → system key from config)
      expect(mockCreateChatModel).toHaveBeenCalled();
      const constructorArg = mockCreateChatModel.mock.calls[0][0];
      expect(constructorArg.apiKey).toBeUndefined();
    });

    it('should pass isGuestMode flag through for guest users', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/image.png',
          name: 'image.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      // Guest mode with no user API key
      const promise = processAttachments(attachments, mockPersonality, true, undefined);

      await vi.runAllTimersAsync();
      await promise;

      // Guest mode should still process images (using free vision models)
      expect(mockCreateChatModel).toHaveBeenCalled();
    });

    it('should use BYOK key even when isGuestMode is false', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/image.png',
          name: 'image.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      const userApiKey = 'user-test-key-67890';
      const promise = processAttachments(attachments, mockPersonality, false, userApiKey);

      await vi.runAllTimersAsync();
      await promise;

      // BYOK user should have their key used
      expect(mockCreateChatModel).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: userApiKey,
        })
      );
    });
  });
});
