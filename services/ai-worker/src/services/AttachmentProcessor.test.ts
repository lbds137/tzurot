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

// Use vi.hoisted() to create mocks that persist across test resets
const { mockDescribeImage, mockTranscribeAudio } = vi.hoisted(() => ({
  mockDescribeImage: vi.fn(),
  mockTranscribeAudio: vi.fn(),
}));

// Mock the MultimodalProcessor module
vi.mock('./MultimodalProcessor.js', () => ({
  describeImage: mockDescribeImage,
  transcribeAudio: mockTranscribeAudio,
}));

describe('AttachmentProcessor', () => {
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
      expect(result[0]).toContain('- Image (photo.png): A beautiful landscape');
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
      expect(result[0]).toContain('- Voice Message (10s): "Hello world"');
      expect(mockTranscribeAudio).toHaveBeenCalledTimes(1);
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
      expect(result[0]).toBe('- File: document.pdf (application/pdf)');
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
      expect(result[0]).toContain('- Image (photo.png)');
      expect(result[1]).toContain('- Voice Message (5s)');
      expect(result[2]).toBe('- File: doc.pdf (application/pdf)');

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
      expect(result[0]).toContain('- Image (broken.png) [vision processing failed]');
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
      expect(result[0]).toContain('- Voice Message (5s) [transcription failed]');
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
      expect(result[0]).toContain('- Image (photo.png): Preprocessed landscape');
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
      expect(result[0]).toContain('- Voice Message (10s): "Preprocessed transcription"');
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
      expect(result[0]).toContain('- Image (photo.png): Inline fallback');
      expect(mockDescribeImage).toHaveBeenCalledTimes(1);
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
      expect(result[0]).toBe('- File: music.mp3 (audio/mp3)');
      expect(mockTranscribeAudio).not.toHaveBeenCalled();
    });
  });
});
