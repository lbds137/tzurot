/**
 * Tests for ReferencedMessageFormatter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReferencedMessageFormatter } from './ReferencedMessageFormatter.js';
import {
  AttachmentType,
  type ReferencedMessage,
  type LoadedPersonality,
} from '@tzurot/common-types';

// Use vi.hoisted() to create mocks that persist across test resets
const { mockDescribeImage, mockTranscribeAudio, mockFormatTimestampWithDelta } = vi.hoisted(() => ({
  mockDescribeImage: vi.fn(),
  mockTranscribeAudio: vi.fn(),
  mockFormatTimestampWithDelta: vi.fn(),
}));

// Mock the MultimodalProcessor module
vi.mock('./MultimodalProcessor.js', () => ({
  describeImage: mockDescribeImage,
  transcribeAudio: mockTranscribeAudio,
}));

// Mock formatTimestampWithDelta for consistent test output
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    formatTimestampWithDelta: mockFormatTimestampWithDelta,
  };
});

describe('ReferencedMessageFormatter', () => {
  let formatter: ReferencedMessageFormatter;
  let mockPersonality: LoadedPersonality;

  beforeEach(() => {
    vi.clearAllMocks();

    // Restore default mock implementations after mockReset clears them
    mockFormatTimestampWithDelta.mockReturnValue({
      absolute: 'Fri, Dec 6, 2025',
      relative: 'just now',
    });

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
      contextWindowTokens: 131072,
      characterInfo: 'Test character',
      personalityTraits: 'Test traits',
    };
  });

  describe('XML wrapper', () => {
    it('should wrap output in <contextual_references> tags', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Test content',
          embeds: '',
          timestamp: '2025-12-06T00:00:00Z',
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      expect(result).toContain('<contextual_references>');
      expect(result).toContain('</contextual_references>');
    });

    it('should still wrap empty references in XML tags', async () => {
      const result = await formatter.formatReferencedMessages([], mockPersonality);

      expect(result).toContain('<contextual_references>');
      expect(result).toContain('</contextual_references>');
    });

    it('should have properly closed XML tags', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'user1',
          authorDisplayName: 'User One',
          content: 'First message',
          embeds: '',
          timestamp: '2025-12-06T00:00:00Z',
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
        },
        {
          referenceNumber: 2,
          discordMessageId: 'msg-456',
          discordUserId: 'user-456',
          authorUsername: 'user2',
          authorDisplayName: 'User Two',
          content: 'Second message',
          embeds: '',
          timestamp: '2025-12-06T00:01:00Z',
          locationContext: 'Test Guild > #random',
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      // Count opening and closing tags
      const openTags = (result.match(/<contextual_references>/g) || []).length;
      const closeTags = (result.match(/<\/contextual_references>/g) || []).length;
      expect(openTags).toBe(1);
      expect(closeTags).toBe(1);

      // Each reference should have opening and closing tags
      const refOpenTags = (result.match(/<quote number="/g) || []).length;
      const refCloseTags = (result.match(/<\/quote>/g) || []).length;
      expect(refOpenTags).toBe(2);
      expect(refCloseTags).toBe(2);
    });

    it('should place content inside XML tags', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Unique test content XYZ123',
          embeds: '',
          timestamp: '2025-12-06T00:00:00Z',
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      // Content should be between the XML tags
      const openTagIndex = result.indexOf('<contextual_references>');
      const closeTagIndex = result.indexOf('</contextual_references>');
      const contentIndex = result.indexOf('Unique test content XYZ123');

      expect(contentIndex).toBeGreaterThan(openTagIndex);
      expect(contentIndex).toBeLessThan(closeTagIndex);
    });

    it('should include relative time delta in timestamp using XML attributes', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Test content',
          embeds: '',
          timestamp: '2025-12-06T00:00:00Z',
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      // Should contain time tag with absolute and relative attributes
      expect(result).toContain('<time absolute="Fri, Dec 6, 2025" relative="just now"/>');
    });
  });

  describe('formatReferencedMessages', () => {
    it('should format a simple text message in XML', async () => {
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
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      expect(result).toContain('<quote number="1" from="Test User" username="testuser">');
      expect(result).toContain('</quote>');
      // Location is now pre-formatted XML from bot-client (DRY with current message context)
      expect(result).toContain('<location type="guild">');
      expect(result).toContain('<server name="Test Guild"/>');
      expect(result).toContain('<channel name="general" type="text"/>');
      // Time now includes both absolute date and relative time (mocked)
      expect(result).toContain('<time absolute="Fri, Dec 6, 2025" relative="just now"/>');
      expect(result).toContain('<content>Hello world!</content>');
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
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      expect(result).toContain('<content>Check this out</content>');
      expect(result).toContain('<embeds>');
      expect(result).toContain('Title: Cool Embed');
      expect(result).toContain('Embed content');
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
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      expect(result).toContain('<quote number="1" from="Test User" username="testuser">');
      // Empty content should not generate <content> tag
      expect(result).not.toContain('<content>');
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
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
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

      expect(result).toContain('<quote number="1" from="User One" username="user1">');
      expect(result).toContain('First message');

      expect(result).toContain('<quote number="2" from="User Two" username="user2">');
      expect(result).toContain('Second message');
    });
  });

  describe('Image attachment processing', () => {
    it('should process image attachments in parallel', async () => {
      // Use hoisted mock directly (mockDescribeImage from vi.hoisted())
      mockDescribeImage.mockImplementation(async (attachment: { name: string }) => {
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
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
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
      // Use hoisted mock directly
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
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
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
      // Use URL-based implementation to avoid mockOnce timing issues with parallel calls
      mockDescribeImage.mockImplementation(
        async (attachment: { url: string; name: string }): Promise<string> => {
          if (attachment.url.includes('image1')) {
            return 'Description of image1';
          }
          if (attachment.url.includes('image2')) {
            throw new Error('Failed');
          }
          if (attachment.url.includes('image3')) {
            return 'Description of image3';
          }
          return 'Unknown';
        }
      );

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
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
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
      // Use hoisted mock directly
      mockTranscribeAudio.mockImplementation(async (attachment: { duration: number }) => {
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
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
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
      // Use hoisted mock directly
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
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
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
      // Use hoisted mocks directly
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
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
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
      // Uses hoisted mockTranscribeAudio - no setup needed, just verify it's not called

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
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
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

      // Empty array still gets wrapped in XML tags
      expect(result).toContain('<contextual_references>');
      expect(result).toContain('</contextual_references>');
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
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
          attachments: [],
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      expect(result).toContain('<quote number="1" from="Test User" username="testuser">');
      expect(result).toContain('Just text');
      expect(result).not.toContain('<attachments>');
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
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      expect(result).toContain('<quote number="1" from="Test User" username="testuser">');
      expect(result).toContain('Just text');
      expect(result).not.toContain('<attachments>');
    });

    it('should format forwarded messages with forwarded attribute', async () => {
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

      // Forwarded messages use shared QuoteFormatter format
      expect(result).toContain('<quote type="forward" from="Unknown">');
      expect(result).not.toContain('forwarded="true"');
      expect(result).toContain('<content>This is a forwarded message</content>');
    });

    it('should format regular (non-forwarded) messages without forwarded attribute', async () => {
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
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
          isForwarded: false,
        },
      ];

      const result = await formatter.formatReferencedMessages(references, mockPersonality);

      // Should NOT have forwarded attribute
      expect(result).toContain('<quote number="1" from="Test User" username="testuser">');
      expect(result).not.toContain('forwarded="true"');
      expect(result).not.toContain('type="forward"');
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
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
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
      expect(result).toContain('<quote number="1" from="Test User" username="testuser">');

      // Second reference - forwarded (uses shared QuoteFormatter format)
      expect(result).toContain('<quote type="forward" from="Unknown">');
      expect(result).toContain('<content>Forwarded message</content>');
    });
  });

  describe('preprocessed attachments', () => {
    it('should use preprocessed image descriptions instead of calling vision API', async () => {
      // Uses hoisted mockDescribeImage - verify it's NOT called when preprocessed data exists

      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Check this image',
          embeds: '',
          timestamp: '2025-11-30T00:00:00Z',
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
          attachments: [
            {
              url: 'https://example.com/image.png',
              contentType: 'image/png',
              name: 'photo.png',
              size: 1000,
            },
          ],
        },
      ];

      // Provide preprocessed data
      const preprocessedAttachments = {
        1: [
          {
            type: AttachmentType.Image,
            description: 'Preprocessed: A beautiful landscape',
            originalUrl: 'https://example.com/image.png',
            metadata: {
              url: 'https://example.com/image.png',
              name: 'photo.png',
              contentType: 'image/png',
              size: 1000,
            },
          },
        ],
      };

      const result = await formatter.formatReferencedMessages(
        references,
        mockPersonality,
        false, // isGuestMode
        preprocessedAttachments
      );

      // Should use preprocessed description
      expect(result).toContain('- Image (photo.png): Preprocessed: A beautiful landscape');

      // Should NOT call vision API
      expect(mockDescribeImage).not.toHaveBeenCalled();
    });

    it('should use preprocessed voice transcriptions instead of calling Whisper API', async () => {
      // Uses hoisted mockTranscribeAudio - verify it's NOT called when preprocessed data exists

      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Listen to this',
          embeds: '',
          timestamp: '2025-11-30T00:00:00Z',
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
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
        },
      ];

      // Provide preprocessed transcription
      const preprocessedAttachments = {
        1: [
          {
            type: AttachmentType.Audio,
            description: 'Preprocessed: Hello, this is a test message',
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
      };

      const result = await formatter.formatReferencedMessages(
        references,
        mockPersonality,
        false,
        preprocessedAttachments
      );

      // Should use preprocessed transcription
      expect(result).toContain(
        '- Voice Message (10s): "Preprocessed: Hello, this is a test message"'
      );

      // Should NOT call Whisper API
      expect(mockTranscribeAudio).not.toHaveBeenCalled();
    });

    it('should fall back to inline processing when no preprocessed data exists', async () => {
      // Use hoisted mock directly
      mockDescribeImage.mockResolvedValue('Inline processed description');

      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Check this',
          embeds: '',
          timestamp: '2025-11-30T00:00:00Z',
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
          attachments: [
            {
              url: 'https://example.com/image.png',
              contentType: 'image/png',
              name: 'photo.png',
              size: 1000,
            },
          ],
        },
      ];

      // No preprocessed data provided (undefined)
      const result = await formatter.formatReferencedMessages(
        references,
        mockPersonality,
        false,
        undefined
      );

      // Should fall back to inline processing
      expect(result).toContain('- Image (photo.png): Inline processed description');
      expect(mockDescribeImage).toHaveBeenCalledTimes(1);
    });

    it('should fall back when preprocessed data has wrong URL', async () => {
      // Use hoisted mock directly
      mockDescribeImage.mockResolvedValue('Inline fallback description');

      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Check this',
          embeds: '',
          timestamp: '2025-11-30T00:00:00Z',
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
          attachments: [
            {
              url: 'https://example.com/actual-image.png',
              contentType: 'image/png',
              name: 'photo.png',
              size: 1000,
            },
          ],
        },
      ];

      // Preprocessed data has different URL
      const preprocessedAttachments = {
        1: [
          {
            type: AttachmentType.Image,
            description: 'Different image description',
            originalUrl: 'https://example.com/different-image.png', // Different URL!
            metadata: {
              url: 'https://example.com/different-image.png',
              name: 'other.png',
              contentType: 'image/png',
              size: 2000,
            },
          },
        ],
      };

      const result = await formatter.formatReferencedMessages(
        references,
        mockPersonality,
        false,
        preprocessedAttachments
      );

      // Should fall back since URL doesn't match
      expect(result).toContain('- Image (photo.png): Inline fallback description');
      expect(mockDescribeImage).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple referenced messages with separate preprocessed data', async () => {
      // Uses hoisted mockDescribeImage - verify it's NOT called when preprocessed data exists

      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-1',
          discordUserId: 'user-1',
          authorUsername: 'user1',
          authorDisplayName: 'User One',
          content: 'First image',
          embeds: '',
          timestamp: '2025-11-30T00:00:00Z',
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
          attachments: [
            {
              url: 'https://example.com/image1.png',
              contentType: 'image/png',
              name: 'image1.png',
              size: 1000,
            },
          ],
        },
        {
          referenceNumber: 2,
          discordMessageId: 'msg-2',
          discordUserId: 'user-2',
          authorUsername: 'user2',
          authorDisplayName: 'User Two',
          content: 'Second image',
          embeds: '',
          timestamp: '2025-11-30T00:01:00Z',
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
          attachments: [
            {
              url: 'https://example.com/image2.png',
              contentType: 'image/png',
              name: 'image2.png',
              size: 2000,
            },
          ],
        },
      ];

      // Each referenced message has its own preprocessed data
      const preprocessedAttachments = {
        1: [
          {
            type: AttachmentType.Image,
            description: 'Description for reference 1',
            originalUrl: 'https://example.com/image1.png',
            metadata: {
              url: 'https://example.com/image1.png',
              name: 'image1.png',
              contentType: 'image/png',
              size: 1000,
            },
          },
        ],
        2: [
          {
            type: AttachmentType.Image,
            description: 'Description for reference 2',
            originalUrl: 'https://example.com/image2.png',
            metadata: {
              url: 'https://example.com/image2.png',
              name: 'image2.png',
              contentType: 'image/png',
              size: 2000,
            },
          },
        ],
      };

      const result = await formatter.formatReferencedMessages(
        references,
        mockPersonality,
        false,
        preprocessedAttachments
      );

      // Both should use their respective preprocessed descriptions
      expect(result).toContain('- Image (image1.png): Description for reference 1');
      expect(result).toContain('- Image (image2.png): Description for reference 2');

      // No inline API calls
      expect(mockDescribeImage).not.toHaveBeenCalled();
    });

    it('should skip preprocessed data with empty description', async () => {
      // Use hoisted mock directly
      mockDescribeImage.mockResolvedValue('Inline description');

      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Image',
          embeds: '',
          timestamp: '2025-11-30T00:00:00Z',
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
          attachments: [
            {
              url: 'https://example.com/image.png',
              contentType: 'image/png',
              name: 'photo.png',
              size: 1000,
            },
          ],
        },
      ];

      // Preprocessed data has empty description
      const preprocessedAttachments = {
        1: [
          {
            type: AttachmentType.Image,
            description: '', // Empty!
            originalUrl: 'https://example.com/image.png',
            metadata: {
              url: 'https://example.com/image.png',
              name: 'photo.png',
              contentType: 'image/png',
              size: 1000,
            },
          },
        ],
      };

      const result = await formatter.formatReferencedMessages(
        references,
        mockPersonality,
        false,
        preprocessedAttachments
      );

      // Should fall back to inline processing since description is empty
      expect(result).toContain('- Image (photo.png): Inline description');
      expect(mockDescribeImage).toHaveBeenCalledTimes(1);
    });
  });

  describe('extractTextForSearch', () => {
    it('should extract plain text content from XML formatted references', () => {
      const formatted = `<contextual_references>
<quote number="1">
<author display_name="Test User" username="testuser"/>
<location type="guild">
<server name="Test Guild"/>
<channel name="general" type="text"/>
</location>
<time absolute="Mon, Nov 4, 2025" relative="2 months ago"/>
<content>Hello world! This is the actual content.</content>
<embeds>Some embed content here.</embeds>
</quote>
</contextual_references>`;

      const result = formatter.extractTextForSearch(formatted);

      // Should include actual content
      expect(result).toContain('Hello world! This is the actual content.');
      expect(result).toContain('Some embed content here.');

      // Should NOT include XML tags
      expect(result).not.toContain('<contextual_references>');
      expect(result).not.toContain('<quote');
      expect(result).not.toContain('<author');
      expect(result).not.toContain('<location');
      expect(result).not.toContain('<time');
    });

    it('should extract image descriptions from XML', () => {
      const formatted = `<contextual_references>
<quote number="1">
<content>Check this image</content>
<attachments>
- Image (sunset.png): A beautiful sunset over the ocean with vibrant orange and pink colors
</attachments>
</quote>
</contextual_references>`;

      const result = formatter.extractTextForSearch(formatted);

      expect(result).toContain(
        'A beautiful sunset over the ocean with vibrant orange and pink colors'
      );
      expect(result).toContain('Check this image');
    });

    it('should extract voice transcriptions from XML', () => {
      const formatted = `<contextual_references>
<quote number="1">
<attachments>
- Voice Message (15s): "Hey, this is a test voice message transcription."
</attachments>
</quote>
</contextual_references>`;

      const result = formatter.extractTextForSearch(formatted);

      expect(result).toContain('Hey, this is a test voice message transcription.');
    });

    it('should handle multiple references', () => {
      const formatted = `<contextual_references>
<quote number="1">
<content>First message content</content>
</quote>
<quote number="2">
<content>Second message content</content>
</quote>
</contextual_references>`;

      const result = formatter.extractTextForSearch(formatted);

      expect(result).toContain('First message content');
      expect(result).toContain('Second message content');
    });

    it('should handle empty formatted string', () => {
      const result = formatter.extractTextForSearch('');
      expect(result).toBe('');
    });

    it('should handle formatted string with only structural XML', () => {
      const formatted = `<contextual_references>
<quote number="1">
<author display_name="User" username="user"/>
<location type="guild">
<server name="Test Guild"/>
<channel name="general" type="text"/>
</location>
<time absolute="Mon, Nov 4, 2025" relative="2 months ago"/>
</quote>
</contextual_references>`;

      const result = formatter.extractTextForSearch(formatted);

      // Proper XML parser extracts no text content from structural-only XML
      expect(result).toBe('');
    });

    it('should preserve multi-line content', () => {
      const formatted = `<contextual_references>
<quote number="1">
<content>Line one
Line two
Line three</content>
</quote>
</contextual_references>`;

      const result = formatter.extractTextForSearch(formatted);

      expect(result).toContain('Line one');
      expect(result).toContain('Line two');
      expect(result).toContain('Line three');
    });

    it('should maintain contract between formatReferencedMessages and extractTextForSearch', async () => {
      // Contract test: Verify that formatReferencedMessages output is compatible with extractTextForSearch
      // This test protects against format changes that would break the text extraction

      // Use hoisted mocks directly
      mockDescribeImage.mockResolvedValue('A cat sitting on a windowsill');
      mockTranscribeAudio.mockResolvedValue('This is a test transcription');

      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Check out this image and voice message!',
          embeds: 'Some embed content',
          timestamp: '2025-11-21T00:00:00Z',
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
          attachments: [
            {
              url: 'https://example.com/image.png',
              name: 'photo.png',
              contentType: 'image/png',
            },
            {
              url: 'https://example.com/voice.ogg',
              name: 'voice.ogg',
              contentType: 'audio/ogg',
              duration: 5,
              isVoiceMessage: true,
            },
          ],
        },
      ];

      // Format the references (real implementation)
      const formatted = await formatter.formatReferencedMessages(references, mockPersonality);

      // Extract text for search (real implementation)
      const extracted = formatter.extractTextForSearch(formatted);

      // Verify contract: actual content is preserved
      expect(extracted).toContain('Check out this image and voice message!');
      expect(extracted).toContain('Some embed content');
      expect(extracted).toContain('A cat sitting on a windowsill');
      expect(extracted).toContain('This is a test transcription');

      // Verify contract: headers and metadata are stripped
      expect(extracted).not.toContain('## Referenced Messages');
      expect(extracted).not.toContain('[Reference 1]');
      expect(extracted).not.toContain('From:');
      expect(extracted).not.toContain('Location:');
      expect(extracted).not.toContain('Time:');
      expect(extracted).not.toContain('Attachments:');
    });
  });
});
