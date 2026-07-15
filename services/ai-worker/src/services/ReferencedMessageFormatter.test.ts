/**
 * Tests for ReferencedMessageFormatter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReferencedMessageFormatter } from './ReferencedMessageFormatter.js';
import { AttachmentType } from '@tzurot/common-types/constants/media';
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';

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
vi.mock('@tzurot/common-types/utils/dateFormatting', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/dateFormatting')>(
    '@tzurot/common-types/utils/dateFormatting'
  );
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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      expect(result).toContain('<contextual_references>');
      expect(result).toContain('</contextual_references>');
    });

    it('should still wrap empty references in XML tags', async () => {
      const { formatted: result } = await formatter.formatReferencedMessages([], mockPersonality);

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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      expect(result).toContain(
        '<quote number="1" from="Test User" username="testuser" role="user">'
      );
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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      expect(result).toContain(
        '<quote number="1" from="Test User" username="testuser" role="user">'
      );
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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      expect(result).toContain('<quote number="1" from="User One" username="user1" role="user">');
      expect(result).toContain('First message');

      expect(result).toContain('<quote number="2" from="User Two" username="user2" role="user">');
      expect(result).toContain('Second message');
    });

    it('renders role="assistant" on a non-deduped quote from the responding persona', async () => {
      // The stamp says "one of our personas"; the render resolves WHICH — the
      // responding persona's own line keeps role="assistant".
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-bot-1',
          discordUserId: 'bot-user-id',
          authorUsername: 'Test Bot',
          authorDisplayName: 'Test Bot',
          content: 'Something I said earlier',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
          authorRole: 'assistant',
        },
      ];

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      expect(result).toContain(
        '<quote number="1" from="Test Bot" username="Test Bot" role="assistant">'
      );
      expect(result).toContain('<content>Something I said earlier</content>');
    });

    it('demotes a stamped-assistant quote from a SIBLING persona to role="character"', async () => {
      // The bot-client stamp says "one of our personas" (applicationId match) — it
      // can't know which persona responds. A sibling's quote must not render as
      // the responding persona's own line.
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-sibling-1',
          discordUserId: 'bot-user-id',
          authorUsername: 'Ha-Shem',
          authorDisplayName: 'Ha-Shem',
          content: 'A sibling persona said this',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext: '',
          authorRole: 'assistant',
        },
      ];

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality,
        false,
        undefined,
        // Demotion requires positive sibling evidence — the caller threads the
        // personalities seen in history (ConversationInputProcessor does this).
        { allPersonalityNames: new Set(['Ha-Shem', 'Test Bot']) }
      );

      expect(result).toContain(
        '<quote number="1" from="Ha-Shem" username="Ha-Shem" role="character">'
      );
      // The legend text mentions role="assistant"; assert on the quote attribute shape.
      expect(result).not.toContain('from="Ha-Shem" username="Ha-Shem" role="assistant"');
    });

    it('renders authorRole="bot" on a non-deduped quote (non-persona automation)', async () => {
      // A non-persona bot/webhook (e.g. MEE6, an unrecognized proxy) reads as
      // role="bot": not us, not the human the user is addressing.
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-bot-2',
          discordUserId: 'other-bot-id',
          authorUsername: 'SomeBot',
          authorDisplayName: 'SomeBot',
          content: 'an automated message',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
          authorRole: 'bot',
        },
      ];

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      expect(result).toContain('<quote number="1" from="SomeBot" username="SomeBot" role="bot">');
    });

    it('falls back to role="user" when authorRole is absent and the author is not a persona', async () => {
      // Pre-classifier / deploy-window references carry no authorRole. The name-match
      // fallback resolves a non-persona author to user — a missing signal never
      // mislabels a human as our own line.
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-legacy',
          discordUserId: 'user-x',
          authorUsername: 'someone',
          authorDisplayName: 'Someone',
          content: 'legacy message',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
        },
      ];

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      expect(result).toContain('<quote number="1" from="Someone" username="someone" role="user">');
    });

    it('falls back to role="assistant" when authorRole is absent but the author matches the active personality', async () => {
      // Deploy-window safety: an old bot-client (pre-classifier) can send a live ref
      // with no authorRole. Without the name-match fallback, our own personality's
      // reply-target would read as role="user" until both services finish deploying,
      // re-opening the self-reply confusion the classifier prevents. mockPersonality's
      // displayName is 'Test Bot', so a 'Test Bot'-authored ref resolves to assistant.
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-self',
          discordUserId: 'bot-x',
          authorUsername: 'test-bot',
          authorDisplayName: 'Test Bot',
          content: 'our own earlier line',
          embeds: '',
          timestamp: '2025-11-04T00:00:00Z',
          locationContext:
            '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
        },
      ];

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      expect(result).toContain('role="assistant"');
    });
  });

  describe('Deduplicated stubs', () => {
    it('should format deduped stubs as lightweight quotes with reply-target note', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'deduped-123',
          discordUserId: 'user-123',
          authorUsername: 'alice123',
          authorDisplayName: 'Alice',
          content: 'Some truncated content...',
          embeds: '',
          timestamp: '2025-12-06T00:00:00Z',
          locationContext: '',
          isDeduplicated: true,
        },
      ];

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      expect(result).toContain('<quote number="1" from="Alice" username="alice123" role="user">');
      expect(result).toContain('[Referenced message — full text in the chat log]');
      expect(result).toContain('Some truncated content...');
      expect(result).toContain('</quote>');
    });

    it('includes a <contextual_references> instruction on how to read quotes', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'm',
          discordUserId: 'u',
          authorUsername: 'a',
          authorDisplayName: 'A',
          content: 'hi',
          embeds: '',
          timestamp: '2025-12-06T00:00:00Z',
          locationContext: '',
        },
      ];
      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );
      expect(result).toContain('<instruction>');
      // Assert all four role clauses — a future edit dropping one would otherwise
      // pass undetected since the assistant clause's substring stays present.
      expect(result).toContain('role="assistant" is one of your own earlier lines');
      expect(result).toContain('role="user" is a person');
      expect(result).toContain('role="character" is a different AI character');
      expect(result).toContain('role="bot" is a non-character bot or automated webhook');
    });

    it('renders role="assistant" on a deduped reply-target from the responding persona', async () => {
      // Deduped stub of the responding persona's own line: role="assistant", marker-only.
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'm',
          discordUserId: 'u',
          authorUsername: 'Test Bot',
          authorDisplayName: 'Test Bot',
          authorRole: 'assistant',
          content: '',
          embeds: '',
          timestamp: '2025-12-06T00:00:00Z',
          locationContext: '',
          isDeduplicated: true,
        },
      ];
      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );
      expect(result).toContain(
        '<quote number="1" from="Test Bot" username="Test Bot" role="assistant">'
      );
      expect(result).toContain('[Referenced message — full text in the chat log]');
    });

    it('renders authorRole="bot" on a deduped third-party reply-target', async () => {
      // A deduped stub from a non-persona bot/webhook reads as role="bot".
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'm',
          discordUserId: 'u',
          authorUsername: 'SomeBot',
          authorDisplayName: 'SomeBot',
          authorRole: 'bot',
          content: 'automated text',
          embeds: '',
          timestamp: '2025-12-06T00:00:00Z',
          locationContext: '',
          isDeduplicated: true,
        },
      ];
      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );
      expect(result).toContain('<quote number="1" from="SomeBot" username="SomeBot" role="bot">');
    });

    it('should not process attachments for deduped stubs', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'deduped-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Has attachments',
          embeds: '',
          timestamp: '2025-12-06T00:00:00Z',
          locationContext: '',
          isDeduplicated: true,
          attachments: [
            {
              url: 'https://example.com/image.png',
              contentType: 'image/png',
              name: 'image.png',
              size: 1000,
            },
          ],
        },
      ];

      await formatter.formatReferencedMessages(references, mockPersonality);

      // Should NOT call vision or transcription APIs
      expect(mockDescribeImage).not.toHaveBeenCalled();
      expect(mockTranscribeAudio).not.toHaveBeenCalled();
    });

    it('should include timestamp for deduped stubs', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'deduped-123',
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User',
          content: 'Stub content',
          embeds: '',
          timestamp: '2025-12-06T00:00:00Z',
          locationContext: '',
          isDeduplicated: true,
        },
      ];

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      expect(result).toContain('<time absolute="Fri, Dec 6, 2025" relative="just now"/>');
    });
  });

  describe('Image attachment processing', () => {
    it('should process image attachments in parallel', async () => {
      // Prove concurrency directly rather than via wall-clock timing: count how many
      // describeImage callbacks overlap. Attachment processing dispatches via
      // Promise.allSettled, so all three enter before any resolves (peak overlap = 3);
      // sequential processing would never exceed 1. Deterministic — no real delays to flake.
      let inFlight = 0;
      let maxInFlight = 0;
      // Use hoisted mock directly (mockDescribeImage from vi.hoisted())
      mockDescribeImage.mockImplementation(async (attachment: { name: string }) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve(); // suspend so concurrently-dispatched callbacks overlap
        inFlight--;
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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      // Verify all images were processed
      expect(mockDescribeImage).toHaveBeenCalledTimes(3);
      expect(result).toContain('- Image (image1.png): Description of image1.png');
      expect(result).toContain('- Image (image2.png): Description of image2.png');
      expect(result).toContain('- Image (image3.png): Description of image3.png');

      // All three describeImage callbacks were in-flight simultaneously → parallel processing.
      expect(maxInFlight).toBe(3);
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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      expect(result).toContain('- Image (image1.png): Description of image1');
      expect(result).toContain('- Image (image2.png) [vision processing failed]');
      expect(result).toContain('- Image (image3.png): Description of image3');
    });
  });

  describe('Voice message processing', () => {
    it('should transcribe voice messages in parallel', async () => {
      // Prove concurrency directly rather than via wall-clock timing: count overlapping
      // transcribe callbacks. Both voice messages dispatch via Promise.allSettled, so peak
      // overlap = 2; sequential would never exceed 1. Deterministic — no real delays.
      let inFlight = 0;
      let maxInFlight = 0;
      // Use hoisted mock directly
      mockTranscribeAudio.mockImplementation(async (attachment: { duration: number }) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve(); // suspend so concurrently-dispatched callbacks overlap
        inFlight--;
        return {
          text: `Transcription of voice ${attachment.duration}s`,
          actualProvider: 'voice-engine',
        };
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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      expect(mockTranscribeAudio).toHaveBeenCalledTimes(2);
      expect(result).toContain('- Voice Message (5s): "Transcription of voice 5s"');
      expect(result).toContain('- Voice Message (10s): "Transcription of voice 10s"');

      // Both transcribe callbacks were in-flight simultaneously → parallel processing.
      expect(maxInFlight).toBe(2);
    });

    it('should handle voice transcription failures gracefully', async () => {
      // Use hoisted mock directly
      mockTranscribeAudio.mockRejectedValue(new Error('STT failed'));

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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      expect(result).toContain('- Voice Message (5s) [transcription failed]');
    });
  });

  describe('Mixed attachment types', () => {
    it('should handle images, voice messages, and files together in parallel', async () => {
      // Use hoisted mocks directly
      mockDescribeImage.mockResolvedValue('Image description');
      mockTranscribeAudio.mockResolvedValue({
        text: 'Voice transcription',
        actualProvider: 'voice-engine',
      });

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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      // Should NOT transcribe non-voice messages
      expect(mockTranscribeAudio).not.toHaveBeenCalled();
      expect(result).toContain('- File: music.mp3 (audio/mp3)');
    });
  });

  describe('Empty and edge cases', () => {
    it('should handle empty references array', async () => {
      const { formatted: result } = await formatter.formatReferencedMessages([], mockPersonality);

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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      expect(result).toContain(
        '<quote number="1" from="Test User" username="testuser" role="user">'
      );
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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      expect(result).toContain(
        '<quote number="1" from="Test User" username="testuser" role="user">'
      );
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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      // Should NOT have forwarded attribute
      expect(result).toContain(
        '<quote number="1" from="Test User" username="testuser" role="user">'
      );
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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality
      );

      // First reference - regular
      expect(result).toContain(
        '<quote number="1" from="Test User" username="testuser" role="user">'
      );

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

      const { formatted: result } = await formatter.formatReferencedMessages(
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

    it('should use preprocessed voice transcriptions instead of calling STT API', async () => {
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

      const { formatted: result } = await formatter.formatReferencedMessages(
        references,
        mockPersonality,
        false,
        preprocessedAttachments
      );

      // Should use preprocessed transcription
      expect(result).toContain(
        '- Voice Message (10s): "Preprocessed: Hello, this is a test message"'
      );

      // Should NOT call STT API
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
      const { formatted: result } = await formatter.formatReferencedMessages(
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

      const { formatted: result } = await formatter.formatReferencedMessages(
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

      const { formatted: result } = await formatter.formatReferencedMessages(
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

      const { formatted: result } = await formatter.formatReferencedMessages(
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

  describe('searchText (the retrieval-query rendering)', () => {
    function makeRef(overrides: Partial<ReferencedMessage> = {}): ReferencedMessage {
      return {
        referenceNumber: 1,
        discordMessageId: 'msg-123',
        discordUserId: 'user-123',
        authorUsername: 'testuser',
        authorDisplayName: 'Test User',
        content: 'The actual message text',
        embeds: '',
        timestamp: '2025-12-06T00:00:00Z',
        locationContext:
          '<location type="guild">\n<server name="Test Guild"/>\n<channel name="general" type="text"/>\n</location>',
        ...overrides,
      };
    }

    it('carries content but never instruction boilerplate, XML, or metadata', async () => {
      const { searchText } = await formatter.formatReferencedMessages([makeRef()], mockPersonality);

      expect(searchText).toBe('The actual message text');
      // The scaffolding classes that polluted embedding queries when search
      // text was tag-stripped from the formatted XML block:
      expect(searchText).not.toContain('read them only to understand');
      expect(searchText).not.toContain('<quote');
      expect(searchText).not.toContain('<contextual_references>');
      expect(searchText).not.toContain('Test Guild');
      expect(searchText).not.toContain('Dec 6');
    });

    it('contributes only the raw text of a deduped stub — never the reply-target marker', async () => {
      const withText = await formatter.formatReferencedMessages(
        [makeRef({ content: 'capped copy of the reply target', isDeduplicated: true })],
        mockPersonality
      );
      expect(withText.searchText).toBe('capped copy of the reply target');
      expect(withText.searchText).not.toContain('full text in the chat log');

      // A bot's own reply-target stub has empty content — nothing to embed.
      const empty = await formatter.formatReferencedMessages(
        [makeRef({ content: '', isDeduplicated: true })],
        mockPersonality
      );
      expect(empty.searchText).toBe('');
      // The marker still renders in the PROMPT block, just not the query.
      expect(empty.formatted).toContain('full text in the chat log');
    });

    it('includes attachment descriptions and embed text, tag-stripped', async () => {
      const { searchText } = await formatter.formatReferencedMessages(
        [
          makeRef({
            content: 'Check this image',
            embeds: '<embed><title>Embed title text</title></embed>',
            attachments: [
              {
                url: 'https://example.com/image.png',
                contentType: 'image/png',
                name: 'photo.png',
                size: 1000,
              },
            ],
          }),
        ],
        mockPersonality,
        false,
        {
          1: [
            {
              type: AttachmentType.Image,
              description: 'A lighthouse at dusk',
              originalUrl: 'https://example.com/image.png',
              metadata: {
                url: 'https://example.com/image.png',
                name: 'photo.png',
                contentType: 'image/png',
                size: 1000,
              },
            },
          ],
        }
      );

      expect(searchText).toContain('Check this image');
      expect(searchText).toContain('A lighthouse at dusk');
      expect(searchText).toContain('Embed title text');
      expect(searchText).not.toContain('<embed>');
      expect(searchText).not.toContain('<title>');
    });

    it('joins multiple references with blank lines, skipping empty contributions', async () => {
      const { searchText } = await formatter.formatReferencedMessages(
        [
          makeRef({ referenceNumber: 1, content: 'first message' }),
          makeRef({ referenceNumber: 2, content: '', isDeduplicated: true }),
          makeRef({ referenceNumber: 3, content: 'third message' }),
        ],
        mockPersonality
      );

      expect(searchText).toBe('first message\n\nthird message');
    });
  });
});
