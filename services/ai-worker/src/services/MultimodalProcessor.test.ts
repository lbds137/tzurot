/**
 * Tests for Multimodal Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { describeImage, transcribeAudio, processAttachments } from './MultimodalProcessor.js';
import type { AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { SYSTEM_SETTINGS_FALLBACKS } from '@tzurot/common-types/schemas/api/systemSettings';
import { AttachmentType, CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import type { ResolveVisionConfigOptions } from './multimodal/visionAuthResolver.js';
import type { ApiKeyResolver } from './ApiKeyResolver.js';

/**
 * Adapt an `invoke`-shaped mock to the `generate` seam `invokeModelGuarded`
 * actually calls. `generate` forwards `(messages[0], options)` — exactly the
 * arguments `invoke` received before — and wraps the resolved message in the
 * `LLMResult` shape core's `invoke` unwraps, so rejections still reject and
 * every existing assertion against the inner mock keeps its meaning.
 */
function generateFromInvokeMock(
  invokeMock: (...args: unknown[]) => unknown
): ReturnType<typeof vi.fn> {
  return vi.fn(async (messages: unknown[], options?: unknown) => ({
    generations: [[{ text: '', message: await invokeMock(messages[0], options) }]],
  }));
}

// Use vi.hoisted() to create mocks that persist across test resets
const {
  mockModelInvoke,
  mockCreateChatModel,
  mockTranscribeAudio,
  mockCheckModelVisionSupport,
  mockVisionCacheGet,
  mockVisionCacheStore,
  mockVisionCacheGetFailure,
  mockVisionCacheStoreFailure,
  mockDescribeImageWithFallback,
} = vi.hoisted(() => ({
  mockModelInvoke: vi.fn(),
  mockCreateChatModel: vi.fn(),
  mockTranscribeAudio: vi.fn(),
  mockCheckModelVisionSupport: vi.fn(),
  mockVisionCacheGet: vi.fn(),
  mockVisionCacheStore: vi.fn(),
  mockVisionCacheGetFailure: vi.fn(),
  mockVisionCacheStoreFailure: vi.fn(),
  mockDescribeImageWithFallback: vi.fn(),
}));

// Runtime system settings. The sticker path reads `fallbackVisionModel` to pin
// the model that writes a permanent shared-asset description.
const { systemSettingMock } = vi.hoisted(() => ({
  systemSettingMock: vi.fn<(key: string) => unknown>(),
}));

vi.mock('@tzurot/common-types/services/SystemSettingsService', async () => {
  const actual = await vi.importActual<
    typeof import('@tzurot/common-types/services/SystemSettingsService')
  >('@tzurot/common-types/services/SystemSettingsService');
  return {
    ...actual,
    getSystemSetting: (key: string) => systemSettingMock(key),
  };
});

// Mock the Phase-4 fallback wrapper so we can assert processAttachments ROUTES the
// visionAuth bundle to it (rather than the single-model describeImage). This is the seam
// where dropping visionAuth silently breaks the extended-context path.
vi.mock('./multimodal/describeImageWithFallback.js', () => ({
  describeImageWithFallback: (...args: unknown[]) => mockDescribeImageWithFallback(...args),
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

// Mock AudioProcessor — orchestrator tests shouldn't test STT internals
vi.mock('./multimodal/AudioProcessor.js', () => ({
  transcribeAudio: (...args: unknown[]) => mockTranscribeAudio(...args),
}));

// Mock redis module (VisionProcessor uses checkModelVisionSupport and visionDescriptionCache)
vi.mock('../redis.js', () => ({
  checkModelVisionSupport: mockCheckModelVisionSupport,
  visionDescriptionCache: {
    tryAcquireInflight: vi.fn().mockResolvedValue(true),
    isInflight: vi.fn().mockResolvedValue(false),
    releaseInflight: vi.fn().mockResolvedValue(undefined),
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
    ownerId: 'owner-uuid-test',
    systemPrompt: 'Test prompt',
    model: 'gpt-4-vision-preview',
    provider: 'openrouter',
    visionModel: 'gpt-4-vision-preview',
    temperature: 0.7,
    maxTokens: 1000,
    contextWindowTokens: 8000,
    characterInfo: 'A test personality',
    personalityTraits: 'Helpful',
    voiceEnabled: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Pin only the operator vision floor; every other key keeps its real
    // registry fallback. A blanket stub would hand model-valued settings a
    // boolean, which breaks selectVisionModel for the non-sticker tests.
    systemSettingMock.mockImplementation((key: string) =>
      key === 'fallbackVisionModel'
        ? 'operator/paid-vision-model'
        : SYSTEM_SETTINGS_FALLBACKS[key as keyof typeof SYSTEM_SETTINGS_FALLBACKS]
    );

    // Reset mock implementations to default
    mockModelInvoke.mockResolvedValue({
      content: 'Mocked image description',
    });

    mockCreateChatModel.mockReturnValue({
      model: { generate: generateFromInvokeMock(mockModelInvoke) },
      modelName: 'test-model',
    });

    // Mock transcribeAudio to return transcription result with actualProvider
    mockTranscribeAudio.mockResolvedValue({
      text: 'Mocked transcription',
      actualProvider: 'voice-engine',
    });

    // Reset redis mocks to default
    mockCheckModelVisionSupport.mockResolvedValue(false); // Default to no vision support
    mockVisionCacheGet.mockResolvedValue(null); // Default: cache miss
    mockVisionCacheStore.mockResolvedValue(undefined);
    mockVisionCacheGetFailure.mockResolvedValue(null); // Default: no failure cached
    mockVisionCacheStoreFailure.mockResolvedValue(undefined);
    mockDescribeImageWithFallback.mockResolvedValue('Fallback-loop description');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('describeImage', () => {
    const mockAttachment = {
      url: 'https://cdn.discordapp.com/image.png',
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
        url: 'https://cdn.discordapp.com/audio.ogg',
        name: 'audio.ogg',
        contentType: CONTENT_TYPES.AUDIO_OGG,
        size: 1024,
      };

      const result = await transcribeAudio(attachment, { provider: 'voice-engine' });

      expect(result.text).toBe('Mocked transcription');
      expect(result.actualProvider).toBe('voice-engine');
      expect(mockTranscribeAudio).toHaveBeenCalledWith(attachment, { provider: 'voice-engine' });
    });

    it('should handle transcription errors', async () => {
      const attachment: AttachmentMetadata = {
        url: 'https://cdn.discordapp.com/audio.ogg',
        name: 'audio.ogg',
        contentType: CONTENT_TYPES.AUDIO_OGG,
        size: 1024,
      };

      mockTranscribeAudio.mockRejectedValue(new Error('No STT provider available'));

      await expect(transcribeAudio(attachment, { provider: 'voice-engine' })).rejects.toThrow(
        'No STT provider available'
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
          url: 'https://cdn.discordapp.com/image1.png',
          name: 'image1.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      const promise = processAttachments(attachments, mockPersonality, { isGuestMode: false });

      // Fast-forward timers for any potential retries
      await vi.runAllTimersAsync();

      const results = await promise;

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        type: AttachmentType.Image,
        description: 'Mocked image description',
        originalUrl: 'https://cdn.discordapp.com/image1.png',
      });
    });

    it('routes an image through describeImageWithFallback when visionAuth is provided', async () => {
      // Wrapper is mocked → no retry timers needed.
      vi.useRealTimers();
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://cdn.discordapp.com/image1.png',
          name: 'image1.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];
      const visionAuth: ResolveVisionConfigOptions = {
        personality: mockPersonality,
        mainProvider: undefined,
        mainApiKey: undefined,
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: {
          resolveApiKey: vi.fn(),
          tryResolveUserKey: vi.fn(),
        } as unknown as ApiKeyResolver,
      };

      const results = await processAttachments(attachments, mockPersonality, {
        isGuestMode: false,
        visionAuth,
      });

      // The visionAuth bundle MUST reach describeImageWithFallback — dropping it silently
      // falls back to single-model describeImage (inert loop + BYOK-key regression).
      expect(mockDescribeImageWithFallback).toHaveBeenCalledWith(
        attachments[0],
        mockPersonality,
        visionAuth,
        expect.objectContaining({ loggingContext: expect.any(Object) })
      );
      expect(results[0]).toMatchObject({
        type: AttachmentType.Image,
        description: 'Fallback-loop description',
      });
    });

    it('funds a STICKER description from the instance, not the triggering user', async () => {
      // A sticker description is keyed by an immutable snowflake, so it is
      // written once and read by everyone forever. Under first-sighter-pays,
      // whoever sights it first would decide — via their key's model — how well
      // it is described for every future reader. The user-attributed inputs
      // must therefore be cleared before the call.
      vi.useRealTimers();
      const stickerAttachment: AttachmentMetadata = {
        id: '111222333444555666',
        url: 'https://cdn.discordapp.com/stickers/111222333444555666.png',
        name: 'partyblob',
        contentType: CONTENT_TYPES.IMAGE_PNG,
        isSticker: true,
      };
      const byokAuth: ResolveVisionConfigOptions = {
        personality: mockPersonality,
        mainProvider: AIProvider.OpenRouter,
        mainApiKey: 'sk-user-byok-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: {
          resolveApiKey: vi.fn(),
          tryResolveUserKey: vi.fn(),
        } as unknown as ApiKeyResolver,
      };

      await processAttachments([stickerAttachment], mockPersonality, {
        isGuestMode: false,
        visionAuth: byokAuth,
      });

      // Assert across the seam: what CROSSES to the describe call is the
      // instance-funded shape, regardless of what the caller resolved.
      expect(mockDescribeImageWithFallback).toHaveBeenCalledWith(
        stickerAttachment,
        mockPersonality,
        expect.objectContaining({
          isGuestMode: true,
          userId: undefined,
          mainApiKey: undefined,
          mainProvider: undefined,
        }),
        expect.objectContaining({ loggingContext: expect.any(Object) })
      );
    });

    it('pins a STICKER to the operator-configured vision model', async () => {
      // The trap this guards: `asInstanceFundedAuth` sets `isGuestMode: true`
      // for auth routing, but that flag is ALSO the tier selector — without an
      // explicit model override, selectVisionModel free-forces every sticker
      // onto the free floor, and the snowflake cache makes that permanent.
      vi.useRealTimers();
      const stickerAttachment: AttachmentMetadata = {
        id: '111222333444555666',
        url: 'https://cdn.discordapp.com/stickers/111222333444555666.png',
        name: 'partyblob',
        contentType: CONTENT_TYPES.IMAGE_PNG,
        isSticker: true,
      };

      await processAttachments([stickerAttachment], mockPersonality, {
        isGuestMode: false,
        visionAuth: {
          personality: mockPersonality,
          mainProvider: AIProvider.OpenRouter,
          mainApiKey: 'sk-user-byok-key',
          isGuestMode: false,
          userId: 'user-1',
          apiKeyResolver: {
            resolveApiKey: vi.fn(),
            tryResolveUserKey: vi.fn(),
          } as unknown as ApiKeyResolver,
        },
      });

      expect(mockDescribeImageWithFallback).toHaveBeenCalledWith(
        stickerAttachment,
        mockPersonality,
        expect.anything(),
        expect.objectContaining({ model: 'operator/paid-vision-model' })
      );
    });

    it('forwards an explicit caller model to the fallback chain for a NON-sticker', async () => {
      // Latent coupling, pinned so it can't drift: the shared-dispatch refactor
      // made this branch forward `model` to describeImageWithFallback, which it
      // previously never received. No caller supplies `model` AND `visionAuth`
      // together today, so this is a no-op in production — but if one ever does,
      // the explicit model must win over selectVisionModel's dynamic resolution,
      // which is what the field's own contract promises.
      vi.useRealTimers();
      const imageAttachment: AttachmentMetadata = {
        url: 'https://cdn.discordapp.com/image1.png',
        name: 'image1.png',
        contentType: CONTENT_TYPES.IMAGE_PNG,
      };

      await processAttachments([imageAttachment], mockPersonality, {
        isGuestMode: false,
        model: 'caller/explicit-model',
        visionAuth: {
          personality: mockPersonality,
          mainProvider: AIProvider.OpenRouter,
          mainApiKey: 'sk-user-byok-key',
          isGuestMode: false,
          userId: 'user-1',
          apiKeyResolver: {
            resolveApiKey: vi.fn(),
            tryResolveUserKey: vi.fn(),
          } as unknown as ApiKeyResolver,
        },
      });

      expect(mockDescribeImageWithFallback).toHaveBeenCalledWith(
        imageAttachment,
        mockPersonality,
        expect.anything(),
        expect.objectContaining({ model: 'caller/explicit-model' })
      );
    });

    it('leaves a NON-sticker image on the caller-resolved auth', async () => {
      // The mirror case: clearing auth for ordinary attachments would silently
      // move every user's image description onto the system key.
      vi.useRealTimers();
      const imageAttachment: AttachmentMetadata = {
        url: 'https://cdn.discordapp.com/image1.png',
        name: 'image1.png',
        contentType: CONTENT_TYPES.IMAGE_PNG,
      };
      const byokAuth: ResolveVisionConfigOptions = {
        personality: mockPersonality,
        mainProvider: AIProvider.OpenRouter,
        mainApiKey: 'sk-user-byok-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: {
          resolveApiKey: vi.fn(),
          tryResolveUserKey: vi.fn(),
        } as unknown as ApiKeyResolver,
      };

      await processAttachments([imageAttachment], mockPersonality, {
        isGuestMode: false,
        visionAuth: byokAuth,
      });

      expect(mockDescribeImageWithFallback).toHaveBeenCalledWith(
        imageAttachment,
        mockPersonality,
        byokAuth,
        expect.objectContaining({ loggingContext: expect.any(Object) })
      );
    });

    it('should process single audio attachment successfully', async () => {
      // Use real timers for this test - we're not testing timeout logic
      vi.useRealTimers();

      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://cdn.discordapp.com/audio1.ogg',
          name: 'audio1.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 2048,
        },
      ];

      const results = await processAttachments(attachments, mockPersonality, {
        isGuestMode: false,
      });

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe(AttachmentType.Audio);
      expect(results[0].originalUrl).toBe('https://cdn.discordapp.com/audio1.ogg');

      // Restore fake timers for subsequent tests
      vi.useFakeTimers();
    });

    it('returns an honest File stub for unsupported types without calling any processor', async () => {
      // The regression shape: a soundless screen-recording video used to fall
      // into the failure-mapping and read as "Audio transcription failed".
      vi.useRealTimers();

      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://cdn.discordapp.com/screen-recording.mp4',
          name: 'screen-recording.mp4',
          contentType: 'video/mp4',
          size: 4096,
        },
      ];

      const results = await processAttachments(attachments, mockPersonality, {
        isGuestMode: false,
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        type: AttachmentType.File,
        description: 'Attachment type video/mp4 is not supported — content not analyzed',
        originalUrl: 'https://cdn.discordapp.com/screen-recording.mp4',
      });
      // Neither paid boundary may fire for an unsupported type.
      expect(mockTranscribeAudio).not.toHaveBeenCalled();
      expect(results[0].description).not.toContain('transcription failed');

      vi.useFakeTimers();
    });

    it('should process multiple attachments in parallel', async () => {
      // Use real timers for this test - we're not testing timeout logic
      vi.useRealTimers();

      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://cdn.discordapp.com/image1.png',
          name: 'image1.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
        {
          url: 'https://cdn.discordapp.com/image2.png',
          name: 'image2.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
        {
          url: 'https://cdn.discordapp.com/audio1.ogg',
          name: 'audio1.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 2048,
        },
      ];

      const results = await processAttachments(attachments, mockPersonality, {
        isGuestMode: false,
      });

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
          url: 'https://cdn.discordapp.com/image1.png',
          name: 'image1.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      mockModelInvoke
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce({ content: 'Success after retries' });

      const promise = processAttachments(attachments, mockPersonality, { isGuestMode: false });

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
          url: 'https://cdn.discordapp.com/image1.png',
          name: 'image1.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      mockModelInvoke.mockRejectedValue(new Error('Permanent failure'));

      const promise = processAttachments(attachments, mockPersonality, { isGuestMode: false });

      // Fast-forward through all retry attempts
      await vi.runAllTimersAsync();

      const results = await promise;

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        type: AttachmentType.Image,
        originalUrl: 'https://cdn.discordapp.com/image1.png',
      });
      // Fallback now includes attempt count and error category
      expect(results[0].description).toMatch(/Image processing failed after \d+ attempts \(/);
      expect(results[0].description).toContain('transient');
      expect(mockModelInvoke).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed success and failure in parallel processing', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://cdn.discordapp.com/image1.png',
          name: 'image1.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
        {
          url: 'https://cdn.discordapp.com/image2.png',
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

      const promise = processAttachments(attachments, mockPersonality, { isGuestMode: false });

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
          url: 'https://cdn.discordapp.com/audio1.ogg',
          name: 'audio1.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 2048,
        },
      ];

      mockTranscribeAudio.mockRejectedValue(new Error('Network error'));

      const promise = processAttachments(attachments, mockPersonality, { isGuestMode: false });

      await vi.runAllTimersAsync();

      const results = await promise;

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        type: AttachmentType.Audio,
        originalUrl: 'https://cdn.discordapp.com/audio1.ogg',
      });
      // Fallback includes error category
      expect(results[0].description).toMatch(/Audio transcription failed after \d+ attempts \(/);
    });

    it('should process empty attachment array', async () => {
      const attachments: AttachmentMetadata[] = [];

      const results = await processAttachments(attachments, mockPersonality, {
        isGuestMode: false,
      });

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
          url: 'https://cdn.discordapp.com/image.png',
          name: 'image.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      const promise = processAttachments(attachments, mockPersonality, { isGuestMode: false });
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
          url: 'https://cdn.discordapp.com/image.png',
          name: 'image.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      const userApiKey = 'user-test-key-12345';
      const promise = processAttachments(attachments, mockPersonality, {
        isGuestMode: false,
        userApiKey,
      });

      await vi.runAllTimersAsync();
      await promise;

      // Verify createChatModel was called with the user's API key
      expect(mockCreateChatModel).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: userApiKey,
        })
      );
    });

    it('never bills a STICKER to the user key, even with no visionAuth bundle', async () => {
      // Several callers omit the visionAuth bundle entirely (DependencyStep's
      // legacy branch, ConversationInputProcessor's defensive branch). The
      // instance-funded rule has to hold on those paths too, or a resolver
      // hiccup silently reverts a permanent shared artifact to first-sighter
      // -pays — with no error and no log line to notice it by.
      const attachments: AttachmentMetadata[] = [
        {
          id: '111222333444555666',
          url: 'https://cdn.discordapp.com/stickers/111222333444555666.png',
          name: 'partyblob',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          isSticker: true,
        },
      ];

      const promise = processAttachments(attachments, mockPersonality, {
        isGuestMode: false,
        userApiKey: 'user-test-key-12345',
      });

      await vi.runAllTimersAsync();
      await promise;

      expect(mockCreateChatModel).toHaveBeenCalled();
      const constructorArg = mockCreateChatModel.mock.calls[0][0] as { apiKey?: string };
      expect(constructorArg.apiKey).not.toBe('user-test-key-12345');
    });

    it('does not pair a STICKER with the personality-resolved provider', async () => {
      // The caller resolves `visionProvider` for the PERSONALITY's vision model.
      // A shared asset uses the operator's model instead, so carrying that
      // provider through pairs a model with the wrong route — describeImage
      // prefers an explicit provider over deriving one, so the mismatch reaches
      // createChatModel and fails at the API rather than describing anything.
      const attachments: AttachmentMetadata[] = [
        {
          id: '111222333444555666',
          url: 'https://cdn.discordapp.com/stickers/111222333444555666.png',
          name: 'partyblob',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          isSticker: true,
        },
      ];

      const promise = processAttachments(attachments, mockPersonality, {
        isGuestMode: false,
        userApiKey: 'user-test-key-12345',
        visionProvider: AIProvider.ZaiCoding,
        model: 'personality/own-vision-model',
      });

      await vi.runAllTimersAsync();
      await promise;

      expect(mockCreateChatModel).toHaveBeenCalled();
      const constructorArg = mockCreateChatModel.mock.calls[0][0] as {
        provider?: string;
        modelName?: string;
        apiKey?: string;
      };
      // Not the caller's provider, and not the caller's model or key either —
      // the whole dispatch set is replaced together.
      expect(constructorArg.provider).not.toBe(AIProvider.ZaiCoding);
      expect(constructorArg.apiKey).not.toBe('user-test-key-12345');
    });

    it('should use system key when userApiKey is undefined', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://cdn.discordapp.com/image.png',
          name: 'image.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      const promise = processAttachments(attachments, mockPersonality, { isGuestMode: false });

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
          url: 'https://cdn.discordapp.com/image.png',
          name: 'image.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      // Guest mode with no user API key
      const promise = processAttachments(attachments, mockPersonality, { isGuestMode: true });

      await vi.runAllTimersAsync();
      await promise;

      // Guest mode should still process images (using free vision models)
      expect(mockCreateChatModel).toHaveBeenCalled();
    });

    it('should use BYOK key even when isGuestMode is false', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://cdn.discordapp.com/image.png',
          name: 'image.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        },
      ];

      const userApiKey = 'user-test-key-67890';
      const promise = processAttachments(attachments, mockPersonality, {
        isGuestMode: false,
        userApiKey,
      });

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
