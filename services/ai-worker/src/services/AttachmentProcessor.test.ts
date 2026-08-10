/**
 * Tests for AttachmentProcessor
 *
 * Tests the parallel attachment processing logic (images, voice messages, files)
 * extracted from ReferencedMessageFormatter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { AttachmentType } from '@tzurot/common-types/constants/media';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { processAttachmentsParallel } from './AttachmentProcessor.js';
import { OWN_VOICE_DESCRIPTION } from './voice/ownVoiceGuard.js';

// Use vi.hoisted() to create mocks that persist across test resets
const {
  mockDescribeImage,
  mockTranscribeAudio,
  mockGetSystemSetting,
  mockLogger,
  mockChildLogger,
} = vi.hoisted(() => {
  const child = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    mockDescribeImage: vi.fn(),
    mockTranscribeAudio: vi.fn(),
    // Defaults to the registry default (sticker vision ON) so every pre-existing
    // case behaves exactly as before; only the kill-switch case flips it.
    mockGetSystemSetting: vi.fn(() => true),
    mockChildLogger: child,
    mockLogger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(() => child),
    },
  };
});

vi.mock('@tzurot/common-types/services/SystemSettingsService', () => ({
  getSystemSetting: mockGetSystemSetting,
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

// Mock the MultimodalProcessor module
vi.mock('./MultimodalProcessor.js', () => ({
  describeImage: mockDescribeImage,
  transcribeAudio: mockTranscribeAudio,
}));

describe('AttachmentProcessor', () => {
  /** The renderable half of each built pair — what these cases assert on. */
  const rendered = (built: { attachment: unknown }[]): unknown[] =>
    built.map(entry => entry.attachment);

  let mockPersonality: LoadedPersonality;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPersonality = {
      id: 'test-personality',
      name: 'TestBot',
      displayName: 'Test Bot',
      slug: 'testbot',
      ownerId: 'owner-uuid-test',
      systemPrompt: 'Test system prompt',
      model: 'test-model',
      provider: 'openrouter',
      temperature: 0.7,
      maxTokens: 2000,
      contextWindowTokens: 131072,
      characterInfo: 'Test character',
      personalityTraits: 'Test traits',
      voiceEnabled: false,
    };
  });

  describe('processAttachmentsParallel', () => {
    it('does not spend a vision call on a sticker when the kill switch is off', async () => {
      // The reference/quoted/forwarded path reaches vision through here, NOT
      // through DownloadAttachmentsStep — so the switch has to bite here too.
      // Without this, turning sticker vision OFF still bills for every sticker
      // in a reply's quoted message: a switch that reads as off while spending.
      // `Once`, not a persistent return: `vi.clearAllMocks()` in beforeEach
      // clears call history but NOT a configured mockReturnValue, so the plain
      // form leaks "switch off" into every later test in the file. Harmless
      // today (nothing below uses a sticker) and a trap tomorrow — the next
      // sticker test added anywhere after this would silently inherit it and
      // fail for a reason unrelated to its own change.
      // One call per processAttachmentsParallel, so Once is exactly the scope.
      mockGetSystemSetting.mockReturnValueOnce(false);

      const result = await processAttachmentsParallel({
        attachments: [
          { url: 'https://cdn/sticker.png', contentType: 'image/png', isSticker: true },
        ],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
      } as never);

      expect(mockDescribeImage).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('still describes a NON-sticker image when the sticker switch is off', async () => {
      // The switch governs stickers only; an ordinary quoted image is untouched.
      // `Once`, not a persistent return: `vi.clearAllMocks()` in beforeEach
      // clears call history but NOT a configured mockReturnValue, so the plain
      // form leaks "switch off" into every later test in the file. Harmless
      // today (nothing below uses a sticker) and a trap tomorrow — the next
      // sticker test added anywhere after this would silently inherit it and
      // fail for a reason unrelated to its own change.
      // One call per processAttachmentsParallel, so Once is exactly the scope.
      mockGetSystemSetting.mockReturnValueOnce(false);
      mockDescribeImage.mockResolvedValue('a photo of a dog');

      await processAttachmentsParallel({
        attachments: [{ url: 'https://cdn/photo.png', contentType: 'image/png' }],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
      } as never);

      expect(mockDescribeImage).toHaveBeenCalled();
    });

    it('CANARY: a later test still sees sticker vision ON (leak check)', async () => {
      // Placed AFTER the two kill-switch cases in file order. If either leaked
      // its `false` return, this sticker would be filtered and describeImage
      // would never fire.
      mockDescribeImage.mockResolvedValue('a sticker of a cat');
      await processAttachmentsParallel({
        attachments: [{ url: 'https://cdn/s.png', contentType: 'image/png', isSticker: true }],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
      } as never);
      expect(mockDescribeImage).toHaveBeenCalled();
    });

    it('should return empty array for empty attachments', async () => {
      const result = await processAttachmentsParallel({
        attachments: [],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
      });

      expect(result).toEqual([]);
    });

    it('should return empty array for undefined attachments', async () => {
      const result = await processAttachmentsParallel({
        attachments: undefined,
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
      });

      expect(result).toEqual([]);
    });

    it('should process image attachments', async () => {
      mockDescribeImage.mockResolvedValue('A beautiful landscape');

      const result = await processAttachmentsParallel({
        attachments: [
          {
            url: 'https://example.com/image.png',
            contentType: 'image/png',
            name: 'photo.png',
            size: 1000,
          },
        ],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
      });

      expect(result).toHaveLength(1);
      expect(result[0].attachment).toEqual({
        kind: 'image',
        filename: 'photo.png',
        contentType: 'image/png',
        description: 'A beautiful landscape',
      });
      expect(mockDescribeImage).toHaveBeenCalledTimes(1);
    });

    it('forwards the resolved vision provider and model to describeImage (cross-provider key)', async () => {
      mockDescribeImage.mockResolvedValue('A cross-provider description');

      await processAttachmentsParallel({
        attachments: [
          {
            url: 'https://example.com/image.png',
            contentType: 'image/png',
            name: 'photo.png',
            size: 1000,
          },
        ],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
        userApiKey: 'vision-provider-key',
        visionProvider: AIProvider.OpenRouter,
        model: 'google/gemma-4-31b-it',
      });

      // The resolved vision key/provider/model must reach describeImage so the
      // reference path doesn't 401 on a cross-provider vision model.
      expect(mockDescribeImage).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com/image.png' }),
        mockPersonality,
        false,
        'vision-provider-key',
        expect.objectContaining({
          provider: AIProvider.OpenRouter,
          model: 'google/gemma-4-31b-it',
        })
      );
    });

    it('should process voice message attachments', async () => {
      mockTranscribeAudio.mockResolvedValue({
        text: 'Hello world',
        actualProvider: 'voice-engine',
      });

      const result = await processAttachmentsParallel({
        attachments: [
          {
            url: 'https://example.com/voice.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 5000,
            isVoiceMessage: true,
            duration: 10,
          },
        ],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
      });

      expect(result).toHaveLength(1);
      expect(result[0].attachment).toEqual({
        kind: 'voice',
        filename: 'voice.ogg',
        contentType: 'audio/ogg',
        durationSeconds: 10,
        description: 'Hello world',
      });
      expect(mockTranscribeAudio).toHaveBeenCalledTimes(1);
    });

    describe("the persona's own voice reference (authorRole)", () => {
      const ownVoiceAttachment = {
        url: 'https://example.com/own-voice.ogg',
        contentType: 'audio/ogg',
        name: 'own-voice.ogg',
        size: 5000,
        isVoiceMessage: true,
        duration: 8,
      };

      it('never calls transcribeAudio for authorRole="assistant" and renders the static description', async () => {
        const result = await processAttachmentsParallel({
          attachments: [ownVoiceAttachment],
          referenceNumber: 1,
          personality: mockPersonality,
          isGuestMode: false,
          authorRole: 'assistant',
        });

        expect(mockTranscribeAudio).not.toHaveBeenCalled();
        expect(result).toHaveLength(1);
        expect(result[0].attachment).toEqual({
          kind: 'voice',
          filename: 'own-voice.ogg',
          contentType: 'audio/ogg',
          durationSeconds: 8,
          description: OWN_VOICE_DESCRIPTION,
        });
      });

      it('ignores a preprocessed transcript too — a cache hit predating this guard is still our own TTS', async () => {
        const result = await processAttachmentsParallel({
          attachments: [ownVoiceAttachment],
          referenceNumber: 1,
          personality: mockPersonality,
          isGuestMode: false,
          authorRole: 'assistant',
          preprocessedAttachments: [
            {
              type: AttachmentType.Audio,
              description: 'a stale cached transcript of our own TTS',
              originalUrl: ownVoiceAttachment.url,
              metadata: ownVoiceAttachment,
            },
          ],
        });

        expect(mockTranscribeAudio).not.toHaveBeenCalled();
        expect(result[0].attachment).toMatchObject({ description: OWN_VOICE_DESCRIPTION });
      });

      it('still transcribes normally for authorRole="user" (unchanged)', async () => {
        mockTranscribeAudio.mockResolvedValue({
          text: 'a human said this',
          actualProvider: 'voice-engine',
        });

        const result = await processAttachmentsParallel({
          attachments: [ownVoiceAttachment],
          referenceNumber: 1,
          personality: mockPersonality,
          isGuestMode: false,
          authorRole: 'user',
        });

        expect(mockTranscribeAudio).toHaveBeenCalledTimes(1);
        expect(result[0].attachment).toMatchObject({ description: 'a human said this' });
      });

      it('still transcribes normally when authorRole is absent (legacy references, unchanged)', async () => {
        mockTranscribeAudio.mockResolvedValue({
          text: 'legacy reference audio',
          actualProvider: 'voice-engine',
        });

        const result = await processAttachmentsParallel({
          attachments: [ownVoiceAttachment],
          referenceNumber: 1,
          personality: mockPersonality,
          isGuestMode: false,
        });

        expect(mockTranscribeAudio).toHaveBeenCalledTimes(1);
        expect(result[0].attachment).toMatchObject({ description: 'legacy reference audio' });
      });
    });

    it('should handle regular file attachments', async () => {
      const result = await processAttachmentsParallel({
        attachments: [
          {
            url: 'https://example.com/doc.pdf',
            contentType: 'application/pdf',
            name: 'document.pdf',
            size: 50000,
          },
        ],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
      });

      expect(result).toHaveLength(1);
      expect(result[0].attachment).toEqual({
        kind: 'file',
        filename: 'document.pdf',
        contentType: 'application/pdf',
      });
      expect(mockDescribeImage).not.toHaveBeenCalled();
      expect(mockTranscribeAudio).not.toHaveBeenCalled();
    });

    it('should process multiple attachments in parallel', async () => {
      // Prove concurrency directly instead of via wall-clock timing: track how many
      // processing callbacks are in-flight simultaneously. Promise.allSettled dispatch
      // means both the image and voice mocks enter before either resolves, so the peak
      // overlap is > 1. Sequential processing would never exceed 1. This is deterministic
      // (no real delays), so it can't flake under load.
      let inFlight = 0;
      let maxInFlight = 0;
      const trackOverlap = async <T>(value: T): Promise<T> => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve(); // suspend so concurrently-dispatched callbacks overlap
        inFlight--;
        return value;
      };
      mockDescribeImage.mockImplementation(() => trackOverlap('Image description'));
      mockTranscribeAudio.mockImplementation(() => trackOverlap('Voice transcription'));

      const result = await processAttachmentsParallel({
        attachments: [
          {
            url: 'https://example.com/image.png',
            contentType: 'image/png',
            name: 'photo.png',
            size: 1000,
          },
          {
            url: 'https://example.com/voice.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 5000,
            isVoiceMessage: true,
            duration: 5,
          },
          {
            url: 'https://example.com/doc.pdf',
            contentType: 'application/pdf',
            name: 'doc.pdf',
            size: 50000,
          },
        ],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
      });

      expect(result).toHaveLength(3);
      expect(result[0].attachment).toMatchObject({ kind: 'image', filename: 'photo.png' });
      expect(result[1].attachment).toMatchObject({
        kind: 'voice',
        filename: 'voice.ogg',
        durationSeconds: 5,
      });
      expect(result[2].attachment).toEqual({
        kind: 'file',
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      });

      // Image + voice callbacks were in-flight at the same time → concurrent dispatch.
      expect(maxInFlight).toBeGreaterThan(1);
    });

    it('should handle image processing failures gracefully', async () => {
      mockDescribeImage.mockRejectedValue(new Error('Vision API failed'));

      const result = await processAttachmentsParallel({
        attachments: [
          {
            url: 'https://example.com/broken.png',
            contentType: 'image/png',
            name: 'broken.png',
            size: 1000,
          },
        ],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
      });

      expect(result).toHaveLength(1);
      // Still rendered, and it says WHY there is no description — an attachment
      // that silently vanishes on failure is the drop class `status` closes.
      expect(result[0].attachment).toEqual({
        kind: 'image',
        filename: 'broken.png',
        contentType: 'image/png',
        status: 'undescribed',
      });
    });

    it('should handle voice transcription failures gracefully', async () => {
      mockTranscribeAudio.mockRejectedValue(new Error('STT failed'));

      const result = await processAttachmentsParallel({
        attachments: [
          {
            url: 'https://example.com/voice.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 5000,
            isVoiceMessage: true,
            duration: 5,
          },
        ],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
      });

      expect(result).toHaveLength(1);
      expect(result[0].attachment).toEqual({
        kind: 'voice',
        filename: 'voice.ogg',
        contentType: 'audio/ogg',
        durationSeconds: 5,
        status: 'untranscribed',
      });
    });

    it('should use preprocessed image descriptions when available', async () => {
      const result = await processAttachmentsParallel({
        attachments: [
          {
            url: 'https://example.com/image.png',
            contentType: 'image/png',
            name: 'photo.png',
            size: 1000,
          },
        ],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
        preprocessedAttachments: [
          {
            type: AttachmentType.Image,
            description: 'Preprocessed landscape',
            originalUrl: 'https://example.com/image.png',
            metadata: {
              url: 'https://example.com/image.png',
              name: 'photo.png',
              contentType: 'image/png',
              size: 1000,
            },
          },
        ],
      });

      expect(result).toHaveLength(1);
      expect(result[0].attachment).toMatchObject({
        kind: 'image',
        filename: 'photo.png',
        description: 'Preprocessed landscape',
      });
      expect(mockDescribeImage).not.toHaveBeenCalled();
    });

    it('should use preprocessed voice transcriptions when available', async () => {
      const result = await processAttachmentsParallel({
        attachments: [
          {
            url: 'https://example.com/voice.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 5000,
            isVoiceMessage: true,
            duration: 10,
          },
        ],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
        preprocessedAttachments: [
          {
            type: AttachmentType.Audio,
            description: 'Preprocessed transcription',
            originalUrl: 'https://example.com/voice.ogg',
            metadata: {
              url: 'https://example.com/voice.ogg',
              name: 'voice.ogg',
              contentType: 'audio/ogg',
              size: 5000,
              isVoiceMessage: true,
              duration: 10,
            },
          },
        ],
      });

      expect(result).toHaveLength(1);
      expect(result[0].attachment).toMatchObject({
        kind: 'voice',
        filename: 'voice.ogg',
        durationSeconds: 10,
        description: 'Preprocessed transcription',
      });
      expect(mockTranscribeAudio).not.toHaveBeenCalled();
    });

    it('should fall back to inline processing when preprocessed URL does not match', async () => {
      mockDescribeImage.mockResolvedValue('Inline fallback');

      const result = await processAttachmentsParallel({
        attachments: [
          {
            url: 'https://example.com/actual.png',
            contentType: 'image/png',
            name: 'photo.png',
            size: 1000,
          },
        ],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
        preprocessedAttachments: [
          {
            type: AttachmentType.Image,
            description: 'Wrong image',
            originalUrl: 'https://example.com/different.png',
            metadata: {
              url: 'https://example.com/different.png',
              name: 'other.png',
              contentType: 'image/png',
              size: 2000,
            },
          },
        ],
      });

      expect(result).toHaveLength(1);
      expect(result[0].attachment).toMatchObject({
        kind: 'image',
        filename: 'photo.png',
        description: 'Inline fallback',
      });
      expect(mockDescribeImage).toHaveBeenCalledTimes(1);
    });

    it('keeps modality and identity when processing throws before dispatch', async () => {
      // The last-resort path: something threw OUTSIDE the per-attachment
      // try/catch, so the processor never got to classify its own failure.
      // Forced here by making the preprocessed lookup throw — the one piece of
      // work that runs before dispatch.
      //
      // What must survive is the SHAPE. An image that blew up must not read as
      // an ordinary document, and it must not vanish: the predecessor rendered
      // a nameless `<file/>` for every rejection, which is indistinguishable
      // from a real unprocessed file and loses the fact that anything failed.
      // Must be NON-empty: findPreprocessedByUrl early-returns on a zero-length
      // list, so an empty array never reaches `.find` and the throw never fires.
      const exploding = [
        {
          type: AttachmentType.Image,
          description: 'unused',
          originalUrl: 'https://example.com/other.png',
          metadata: {
            url: 'https://example.com/other.png',
            name: 'other.png',
            contentType: 'image/png',
            size: 1,
          },
        },
      ];
      exploding.find = () => {
        throw new Error('boom before dispatch');
      };

      const result = await processAttachmentsParallel({
        attachments: [
          {
            url: 'https://example.com/photo.png',
            contentType: 'image/png',
            name: 'photo.png',
            size: 1000,
          },
        ],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
        preprocessedAttachments: exploding,
      });

      expect(rendered(result)).toEqual([
        {
          kind: 'image',
          filename: 'photo.png',
          contentType: 'image/png',
          status: 'unprocessed',
        },
      ]);
    });

    it('preserves each modality across the pre-dispatch failure', async () => {
      // The voice and file arms of the same fallback. Covered explicitly rather
      // than left to "it mirrors the image arm": the whole point of the arm is
      // that a failed voice message does not read as a document, so an untested
      // arm is exactly where that would regress unnoticed.
      const exploding = [
        {
          type: AttachmentType.Image,
          description: 'unused',
          originalUrl: 'https://example.com/other.png',
          metadata: {
            url: 'https://example.com/other.png',
            name: 'other.png',
            contentType: 'image/png',
            size: 1,
          },
        },
      ];
      exploding.find = () => {
        throw new Error('boom before dispatch');
      };

      const result = await processAttachmentsParallel({
        attachments: [
          {
            url: 'https://example.com/note.ogg',
            contentType: 'audio/ogg',
            name: 'note.ogg',
            size: 100,
            isVoiceMessage: true,
            duration: 4,
          },
          {
            url: 'https://example.com/doc.pdf',
            contentType: 'application/pdf',
            name: 'doc.pdf',
            size: 200,
          },
        ],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
        preprocessedAttachments: exploding,
      });

      expect(rendered(result)).toEqual([
        {
          kind: 'voice',
          filename: 'note.ogg',
          contentType: 'audio/ogg',
          // Duration comes from Discord's metadata, not from the transcription
          // that failed — so it survives the failure.
          durationSeconds: 4,
          status: 'unprocessed',
        },
        {
          kind: 'file',
          filename: 'doc.pdf',
          contentType: 'application/pdf',
          status: 'unprocessed',
        },
      ]);
    });

    it('pairs each built element with its source URL', async () => {
      // Not rendered — it is the key the enrichment gets written down under, so
      // a description the model saw this turn can be replayed the next one.
      const result = await processAttachmentsParallel({
        attachments: [
          { url: 'https://example.com/a.png', contentType: 'image/png', name: 'a.png', size: 1 },
          {
            url: 'https://example.com/b.pdf',
            contentType: 'application/pdf',
            name: 'b.pdf',
            size: 2,
          },
        ],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
      });

      expect(result.map(entry => entry.url)).toEqual([
        'https://example.com/a.png',
        'https://example.com/b.pdf',
      ]);
    });

    it('should treat non-voice audio files as regular files', async () => {
      const result = await processAttachmentsParallel({
        attachments: [
          {
            url: 'https://example.com/music.mp3',
            contentType: 'audio/mp3',
            name: 'music.mp3',
            size: 5000000,
            isVoiceMessage: false,
          },
        ],
        referenceNumber: 1,
        personality: mockPersonality,
        isGuestMode: false,
      });

      expect(result).toHaveLength(1);
      expect(result[0].attachment).toEqual({
        kind: 'file',
        filename: 'music.mp3',
        contentType: 'audio/mp3',
      });
      expect(mockTranscribeAudio).not.toHaveBeenCalled();
    });
  });

  describe('requestId correlation', () => {
    // The reason this module logs at all is to explain a reference whose
    // enrichment went missing, and a failure line nobody can tie back to the
    // request that produced it is close to unusable. The binding is pure
    // correlation — nothing below asserts on rendered output, because none of it
    // changes.
    const imageOptions = (
      requestId?: string
    ): Parameters<typeof processAttachmentsParallel>[0] => ({
      attachments: [
        {
          url: 'https://example.com/broken.png',
          contentType: 'image/png',
          name: 'broken.png',
          size: 1000,
        },
      ],
      referenceNumber: 1,
      personality: mockPersonality,
      isGuestMode: false,
      requestId,
    });

    it('emits the image failure through a logger bound to the requestId', async () => {
      mockDescribeImage.mockRejectedValue(new Error('Vision API failed'));

      await processAttachmentsParallel(imageOptions('req-image'));

      expect(mockLogger.child).toHaveBeenCalledWith({ requestId: 'req-image' });
      expect(mockChildLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ referenceNumber: 1, url: 'https://example.com/broken.png' }),
        'Image processing failed'
      );
      // The unbound module logger must not carry the line — an uncorrelated copy
      // is the state this change exists to remove.
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('emits the voice failure through the bound logger', async () => {
      mockTranscribeAudio.mockRejectedValue(new Error('STT failed'));

      await processAttachmentsParallel({
        attachments: [
          {
            url: 'https://example.com/voice.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 5000,
            isVoiceMessage: true,
            duration: 5,
          },
        ],
        referenceNumber: 2,
        personality: mockPersonality,
        isGuestMode: false,
        requestId: 'req-voice',
      });

      expect(mockLogger.child).toHaveBeenCalledWith({ requestId: 'req-voice' });
      expect(mockChildLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ referenceNumber: 2, url: 'https://example.com/voice.ogg' }),
        'Voice transcription failed'
      );
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('correlates the fan-out catch, not only the per-modality failures', async () => {
      // The pre-dispatch throw (same forced shape as the modality-preservation
      // cases above) is the one failure site OUTSIDE the two helpers, so it is
      // the one that would silently keep the unbound logger.
      const exploding = [
        {
          type: AttachmentType.Image,
          description: 'unused',
          originalUrl: 'https://example.com/other.png',
          metadata: {
            url: 'https://example.com/other.png',
            name: 'other.png',
            contentType: 'image/png',
            size: 1,
          },
        },
      ];
      exploding.find = () => {
        throw new Error('boom before dispatch');
      };

      await processAttachmentsParallel({
        ...imageOptions('req-fanout'),
        preprocessedAttachments: exploding,
      });

      expect(mockLogger.child).toHaveBeenCalledWith({ requestId: 'req-fanout' });
      expect(mockChildLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ referenceNumber: 1, url: 'https://example.com/broken.png' }),
        'Unexpected error in attachment processing'
      );
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('threads the bound logger into withRetry so retry warnings correlate too', async () => {
      // withRetry raises its own warnings between attempts. Those are the lines
      // that say a paid call was retried, so leaving them on the module logger
      // would strand exactly the spend evidence next to a correlated failure.
      mockDescribeImage.mockRejectedValue(new Error('Vision API failed'));

      await processAttachmentsParallel(imageOptions('req-retry'));

      expect(mockChildLogger.warn).toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('uses the module logger when no requestId is threaded', async () => {
      // Legacy callers thread nothing; they must not pay for a child binding and
      // must keep logging exactly as before.
      mockDescribeImage.mockRejectedValue(new Error('Vision API failed'));

      await processAttachmentsParallel(imageOptions());

      expect(mockLogger.child).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ referenceNumber: 1, url: 'https://example.com/broken.png' }),
        'Image processing failed'
      );
      expect(mockChildLogger.error).not.toHaveBeenCalled();
    });
  });
});
