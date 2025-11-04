/**
 * Tests for ReferencedMessageFormatter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReferencedMessageFormatter } from './ReferencedMessageFormatter.js';
import type { ReferencedMessage, LoadedPersonality } from '@tzurot/common-types';

// Mock the MultimodalProcessor module
vi.mock('./MultimodalProcessor.js', () => ({
  describeImage: vi.fn(),
  transcribeAudio: vi.fn(),
}));

describe('ReferencedMessageFormatter', () => {
  let formatter: ReferencedMessageFormatter;
  let mockPersonality: LoadedPersonality;

  beforeEach(() => {
    formatter = new ReferencedMessageFormatter();
    mockPersonality = {
      id: 'test-personality',
      name: 'TestBot',
      displayName: 'Test Bot',
      slug: 'testbot',
      systemPrompt: 'Test system prompt',
      model: 'test-model',
      temperature: 0.7,
      maxTokens: 2000,
      contextWindow: 8000,
      characterInfo: 'Test character',
      personalityTraits: 'Test traits',
    };

    vi.clearAllMocks();
  });

  describe('formatReferencedMessages', () => {
    it('should format a simple text message', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Hello world!',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext: 'Test Guild > #general',
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      expect(result).toContain('## Referenced Messages');
      expect(result).toContain('[Reference 1]');
      expect(result).toContain('From: Test User (@testuser)');
      expect(result).toContain('Location:\nTest Guild > #general');
      expect(result).toContain('Time: 2025-11-04T00:00:00Z');
      expect(result).toContain('Message Text:\nHello world!');
    });

    it('should format message with embeds', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Check this out',
          embeds: 'Title: Cool Embed\nDescription: Embed content',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext: 'Test Guild > #general',
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      expect(result).toContain('Message Text:\nCheck this out');
      expect(result).toContain('Message Embeds (structured data from Discord):\n');
      expect(result).toContain('Title: Cool Embed\nDescription: Embed content');
    });

    it('should handle message with no content', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: '',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext: 'Test Guild > #general',
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      expect(result).toContain('[Reference 1]');
      expect(result).toContain('From: Test User (@testuser)');
      expect(result).not.toContain('Message Text:');
    });

    it('should format multiple references', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'user1',
          authorDisplayName: 'User One',
          content: 'First message',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext: 'Test Guild > #general',
        },
        {
          referenceNumber: 2,
          discordMessageId: 'msg-456',
          discordUserId: 'user-456',
          authorUsername: 'user2',
          authorDisplayName: 'User Two',
          content: 'Second message',
          embeds: '',
          timestamp: '2025-11-04T00:01:00Z',
          locationContext: 'Test Guild > #random',
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      expect(result).toContain('[Reference 1]');
      expect(result).toContain('From: User One (@user1)');
      expect(result).toContain('First message');

      expect(result).toContain('[Reference 2]');
      expect(result).toContain('From: User Two (@user2)');
      expect(result).toContain('Second message');
    });
  });

  describe('Image attachment processing', () => {
    it('should process image attachments in parallel', async () => {
      const { describeImage } = await import('./MultimodalProcessor.js');
      const mockDescribeImage = vi.mocked(describeImage);

      // Mock describeImage to return different descriptions with delays
      mockDescribeImage.mockImplementation(async attachment => {
        await new Promise(resolve => setTimeout(resolve, 100)); // Simulate processing time
        return `Description of ${attachment.name}`;
      });

      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Check these images',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext: 'Test Guild > #general',
          attachments: [
            {
              url: 'https://example.com/image1.png',
              contentType: 'image/png',
              name: 'image1.png',
              size: 1000,
            },
            {
              url: 'https://example.com/image2.png',
              contentType: 'image/png',
              name: 'image2.png',
              size: 2000,
            },
            {
              url: 'https://example.com/image3.png',
              contentType: 'image/png',
              name: 'image3.png',
              size: 3000,
            },
          ],
        },
      ];

      const startTime = Date.now();
      const result = await formatter.formatReferencedMessages(references, mockPersonality);
      const duration = Date.now() - startTime;

      // Verify all images were processed
      expect(mockDescribeImage).toHaveBeenCalledTimes(3);
      expect(result).toContain('- Image (image1.png): Description of image1.png');
      expect(result).toContain('- Image (image2.png): Description of image2.png');
      expect(result).toContain('- Image (image3.png): Description of image3.png');

      // Verify parallel processing (should take ~100ms not ~300ms)
      // Allow some overhead but ensure it's significantly faster than sequential
      expect(duration).toBeLessThan(250);
    });

    it('should handle image processing failures gracefully', async () => {
      const { describeImage } = await import('./MultimodalProcessor.js');
      const mockDescribeImage = vi.mocked(describeImage);

      mockDescribeImage.mockRejectedValue(new Error('Vision model failed'));

      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Image',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext: 'Test Guild > #general',
          attachments: [
            {
              url: 'https://example.com/broken.png',
              contentType: 'image/png',
              name: 'broken.png',
              size: 1000,
            },
          ],
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      expect(result).toContain('- Image (broken.png) [vision processing failed]');
    });

    it('should handle mixed success and failure in parallel processing', async () => {
      const { describeImage } = await import('./MultimodalProcessor.js');
      const mockDescribeImage = vi.mocked(describeImage);

      // First image succeeds, second fails, third succeeds
      mockDescribeImage
        .mockResolvedValueOnce('Description of image1')
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce('Description of image3');

      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Images',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext: 'Test Guild > #general',
          attachments: [
            {
              url: 'https://example.com/image1.png',
              contentType: 'image/png',
              name: 'image1.png',
              size: 1000,
            },
            {
              url: 'https://example.com/image2.png',
              contentType: 'image/png',
              name: 'image2.png',
              size: 2000,
            },
            {
              url: 'https://example.com/image3.png',
              contentType: 'image/png',
              name: 'image3.png',
              size: 3000,
            },
          ],
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      expect(result).toContain('- Image (image1.png): Description of image1');
      expect(result).toContain('- Image (image2.png) [vision processing failed]');
      expect(result).toContain('- Image (image3.png): Description of image3');
    });
  });

  describe('Voice message processing', () => {
    it('should transcribe voice messages in parallel', async () => {
      const { transcribeAudio } = await import('./MultimodalProcessor.js');
      const mockTranscribeAudio = vi.mocked(transcribeAudio);

      mockTranscribeAudio.mockImplementation(async attachment => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return `Transcription of voice ${attachment.duration}s`;
      });

      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: '',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext: 'Test Guild > #general',
          attachments: [
            {
              url: 'https://example.com/voice1.ogg',
              contentType: 'audio/ogg',
              name: 'voice1.ogg',
              size: 5000,
              isVoiceMessage: true,
              duration: 5,
            },
            {
              url: 'https://example.com/voice2.ogg',
              contentType: 'audio/ogg',
              name: 'voice2.ogg',
              size: 10000,
              isVoiceMessage: true,
              duration: 10,
            },
          ],
        },
      ];

      const startTime = Date.now();
      const result = await formatter.formatReferencedMessages(references, mockPersonality);
      const duration = Date.now() - startTime;

      expect(mockTranscribeAudio).toHaveBeenCalledTimes(2);
      expect(result).toContain('- Voice Message (5s): "Transcription of voice 5s"');
      expect(result).toContain('- Voice Message (10s): "Transcription of voice 10s"');

      // Verify parallel processing
      expect(duration).toBeLessThan(250);
    });

    it('should handle voice transcription failures gracefully', async () => {
      const { transcribeAudio } = await import('./MultimodalProcessor.js');
      const mockTranscribeAudio = vi.mocked(transcribeAudio);

      mockTranscribeAudio.mockRejectedValue(new Error('Whisper API failed'));

      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: '',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext: 'Test Guild > #general',
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
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      expect(result).toContain('- Voice Message (5s) [transcription failed]');
    });
  });

  describe('Mixed attachment types', () => {
    it('should handle images, voice messages, and files together in parallel', async () => {
      const { describeImage, transcribeAudio } = await import('./MultimodalProcessor.js');
      const mockDescribeImage = vi.mocked(describeImage);
      const mockTranscribeAudio = vi.mocked(transcribeAudio);

      mockDescribeImage.mockResolvedValue('Image description');
      mockTranscribeAudio.mockResolvedValue('Voice transcription');

      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Mixed attachments',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext: 'Test Guild > #general',
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
              url: 'https://example.com/document.pdf',
              contentType: 'application/pdf',
              name: 'document.pdf',
              size: 50000,
            },
          ],
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      expect(result).toContain('- Image (photo.png): Image description');
      expect(result).toContain('- Voice Message (5s): "Voice transcription"');
      expect(result).toContain('- File: document.pdf (application/pdf)');

      // Both async processors should have been called
      expect(mockDescribeImage).toHaveBeenCalledTimes(1);
      expect(mockTranscribeAudio).toHaveBeenCalledTimes(1);
    });

    it('should handle non-voice audio files as regular files', async () => {
      const { transcribeAudio } = await import('./MultimodalProcessor.js');
      const mockTranscribeAudio = vi.mocked(transcribeAudio);

      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Audio file',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext: 'Test Guild > #general',
          attachments: [
            {
              url: 'https://example.com/music.mp3',
              contentType: 'audio/mp3',
              name: 'music.mp3',
              size: 5000000,
              isVoiceMessage: false,
            },
          ],
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      // Should NOT transcribe non-voice messages
      expect(mockTranscribeAudio).not.toHaveBeenCalled();
      expect(result).toContain('- File: music.mp3 (audio/mp3)');
    });
  });

  describe('Empty and edge cases', () => {
    it('should handle empty references array', async () => {
      const result = await formatter.formatReferencedMessages([], mockPersonality);

      expect(result).toContain('## Referenced Messages');
      expect(result).toContain('The user is referencing the following messages:');
    });

    it('should handle reference with no attachments', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Just text',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext: 'Test Guild > #general',
          attachments: [],
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      expect(result).toContain('[Reference 1]');
      expect(result).toContain('Just text');
      expect(result).not.toContain('Attachments:');
    });

    it('should handle reference with undefined attachments', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Just text',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext: 'Test Guild > #general',
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      expect(result).toContain('[Reference 1]');
      expect(result).toContain('Just text');
      expect(result).not.toContain('Attachments:');
    });

    it('should format forwarded messages with [FORWARDED MESSAGE] indicator', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'forwarded-123',
          discordUserId: 'unknown',
          authorUsername: 'Unknown User',
          authorDisplayName: 'Unknown User',
          content: 'This is a forwarded message',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext: 'Test Guild > #general (forwarded message)',
          isForwarded: true,
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      // Should have forwarded indicator
      expect(result).toContain('[Reference 1] [FORWARDED MESSAGE]');
      expect(result).toContain('[Author unavailable - this message was forwarded]');
      expect(result).toContain('This is a forwarded message');
      expect(result).toContain('(forwarded message)');
    });

    it('should format regular (non-forwarded) messages without indicator', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'regular-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'This is a regular message',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext: 'Test Guild > #general',
          isForwarded: false,
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      // Should NOT have forwarded indicator
      expect(result).toContain('[Reference 1]');
      expect(result).not.toContain('[FORWARDED MESSAGE]');
      expect(result).toContain('From: Test User (@testuser)');
      expect(result).not.toContain('[Author unavailable');
    });

    it('should handle mixed forwarded and regular references', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'regular-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Regular message',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext: 'Test Guild > #general',
        },
        {
          referenceNumber: 2,
          discordMessageId: 'forwarded-123',
          discordUserId: 'unknown',
          authorUsername: 'Unknown User',
          authorDisplayName: 'Unknown User',
          content: 'Forwarded message',
          embeds: '',
          timestamp: '2025-11-04T00:01:00Z',
          locationContext: 'Test Guild > #general (forwarded message)',
          isForwarded: true,
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      // First reference - regular
      expect(result).toContain('[Reference 1]');
      expect(result).toContain('From: Test User (@testuser)');

      // Second reference - forwarded
      expect(result).toContain('[Reference 2] [FORWARDED MESSAGE]');
      expect(result).toContain('[Author unavailable - this message was forwarded]');
    });
  });
});
