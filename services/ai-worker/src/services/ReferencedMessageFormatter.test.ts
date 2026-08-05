/**
 * Tests for ReferencedMessageFormatter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReferencedMessageFormatter } from './ReferencedMessageFormatter.js';
import { AttachmentType } from '@tzurot/common-types/constants/media';
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { type ProcessedAttachment } from './MultimodalProcessor.js';

// Use vi.hoisted() to create mocks that persist across test resets
const {
  mockDescribeImage,
  mockTranscribeAudio,
  mockFormatPromptTimestamp,
  mockLogger,
  mockChildLogger,
} = vi.hoisted(() => {
  // AttachmentProcessor binds a request-scoped child off the same mocked
  // createLogger, so `child` has to exist here for the live attachment path to
  // run at all — and the implementation is passed to vi.fn() rather than
  // configured afterwards so a mock reset restores it.
  const child = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    mockDescribeImage: vi.fn(),
    mockTranscribeAudio: vi.fn(),
    mockFormatPromptTimestamp: vi.fn(),
    mockChildLogger: child,
    mockLogger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(() => child),
    },
  };
});

// Mock the MultimodalProcessor module
vi.mock('./MultimodalProcessor.js', () => ({
  describeImage: mockDescribeImage,
  transcribeAudio: mockTranscribeAudio,
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

// Mock formatPromptTimestamp for consistent test output
vi.mock('@tzurot/common-types/utils/dateFormatting', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/dateFormatting')>(
    '@tzurot/common-types/utils/dateFormatting'
  );
  return {
    ...actual,
    formatPromptTimestamp: mockFormatPromptTimestamp,
  };
});

describe('ReferencedMessageFormatter', () => {
  let formatter: ReferencedMessageFormatter;
  let mockPersonality: LoadedPersonality;

  beforeEach(() => {
    vi.clearAllMocks();

    // Restore default mock implementations after mockReset clears them
    mockFormatPromptTimestamp.mockReturnValue('2025-12-06 (Fri) 00:00 • just now');

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

      // One timestamp format across every quote path: the t attribute, built by
      // the same helper <message> uses in <chat_log>. The live paths used to
      // render a <time absolute relative/> child instead, so the same quote
      // carried its timestamp two different ways depending on its source.
      expect(result).toContain('t="2025-12-06 (Fri) 00:00 • just now"');
      expect(result).not.toContain('<time');
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
        '<quote number="1" from="Test User" username="testuser" role="user"'
      );
      expect(result).toContain('</quote>');
      // Location is now pre-formatted XML from bot-client (DRY with current message context)
      expect(result).toContain('<location type="guild">');
      expect(result).toContain('<server name="Test Guild"/>');
      expect(result).toContain('<channel name="general" type="text"/>');
      // Time now includes both absolute date and relative time (mocked)
      expect(result).toContain('t="2025-12-06 (Fri) 00:00 • just now"');
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
        '<quote number="1" from="Test User" username="testuser" role="user"'
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

      expect(result).toContain('<quote number="1" from="User One" username="user1" role="user"');
      expect(result).toContain('First message');

      expect(result).toContain('<quote number="2" from="User Two" username="user2" role="user"');
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

      expect(result).toContain('<quote number="1" from="Test Bot" role="assistant"');
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

      expect(result).toContain('<quote number="1" from="Ha-Shem" role="character"');
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

      expect(result).toContain('<quote number="1" from="SomeBot" role="bot"');
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

      expect(result).toContain('<quote number="1" from="Someone" username="someone" role="user"');
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

      expect(result).toContain('<quote number="1" from="Alice" username="alice123" role="user"');
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
      expect(result).toContain('<quote number="1" from="Test Bot" role="assistant"');
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
      expect(result).toContain('<quote number="1" from="SomeBot" role="bot"');
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

      expect(result).toContain('t="2025-12-06 (Fri) 00:00 • just now"');
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
      expect(result).toContain(
        '<image filename="image1.png" type="image/png">Description of image1.png</image>'
      );
      expect(result).toContain(
        '<image filename="image2.png" type="image/png">Description of image2.png</image>'
      );
      expect(result).toContain(
        '<image filename="image3.png" type="image/png">Description of image3.png</image>'
      );

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

      expect(result).toContain(
        '<image filename="broken.png" type="image/png" status="undescribed"/>'
      );
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

      expect(result).toContain(
        '<image filename="image1.png" type="image/png">Description of image1</image>'
      );
      expect(result).toContain(
        '<image filename="image2.png" type="image/png" status="undescribed"/>'
      );
      expect(result).toContain(
        '<image filename="image3.png" type="image/png">Description of image3</image>'
      );
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
      expect(result).toContain(
        '<voice filename="voice1.ogg" type="audio/ogg" duration="5s">Transcription of voice 5s</voice>'
      );
      expect(result).toContain(
        '<voice filename="voice2.ogg" type="audio/ogg" duration="10s">Transcription of voice 10s</voice>'
      );

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

      expect(result).toContain(
        '<voice filename="voice.ogg" type="audio/ogg" duration="5s" status="untranscribed"/>'
      );
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

      expect(result).toContain(
        '<image filename="photo.png" type="image/png">Image description</image>'
      );
      expect(result).toContain(
        '<voice filename="voice.ogg" type="audio/ogg" duration="5s">Voice transcription</voice>'
      );
      expect(result).toContain('<file filename="document.pdf" type="application/pdf"/>');

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
      expect(result).toContain('<file filename="music.mp3" type="audio/mp3"/>');
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
        '<quote number="1" from="Test User" username="testuser" role="user"'
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
        '<quote number="1" from="Test User" username="testuser" role="user"'
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

      // A forwarded reference is now rendered by the SAME renderer as any
      // other, with forwarding as a field on it. It therefore keeps its
      // reference number, role and location, all of which the old
      // forwarded-only wrapper dropped — and `from` is the author the
      // reference actually carries ('Unknown User', because Discord strips
      // author identity from message snapshots) rather than a literal the
      // wrapper hardcoded because it had nothing to render.
      expect(result).toContain('<quote number="1" type="forward" from="Unknown User" role="user"');
      expect(result).not.toContain('forwarded="true"');
      expect(result).toContain('<content>This is a forwarded message</content>');
      expect(result).toContain('(forwarded message)');
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
        '<quote number="1" from="Test User" username="testuser" role="user"'
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
        '<quote number="1" from="Test User" username="testuser" role="user"'
      );

      // Second reference - forwarded, and now numbered like every other quote
      expect(result).toContain('<quote number="2" type="forward" from="Unknown User" role="user"');
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
      expect(result).toContain(
        '<image filename="photo.png" type="image/png">Preprocessed: A beautiful landscape</image>'
      );

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
        '<voice filename="voice.ogg" type="audio/ogg" duration="10s">Preprocessed: Hello, this is a test message</voice>'
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
      expect(result).toContain(
        '<image filename="photo.png" type="image/png">Inline processed description</image>'
      );
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
      expect(result).toContain(
        '<image filename="photo.png" type="image/png">Inline fallback description</image>'
      );
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
      expect(result).toContain(
        '<image filename="image1.png" type="image/png">Description for reference 1</image>'
      );
      expect(result).toContain(
        '<image filename="image2.png" type="image/png">Description for reference 2</image>'
      );

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
      expect(result).toContain(
        '<image filename="photo.png" type="image/png">Inline description</image>'
      );
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

  /**
   * Enrichment traceability — the economic invariant: PAID WORK MUST APPEAR.
   *
   * Vision and transcription cost money and latency before this renderer runs.
   * Whatever reaches it must come out the other side, in every render mode. The
   * assertion is deliberately NOT a field-by-field parity check: the two bugs of
   * this class dropped two DIFFERENT fields (`authorRole`, then image
   * descriptions), so enumerating fields only ever catches the last one. A
   * sentinel that must survive catches whichever field goes next.
   *
   * Line coverage was green through both bugs — the dropped values executed,
   * they just went nowhere. This is an oracle, not more coverage.
   *
   * The stored half of the matrix lives in xmlMetadataFormatters.test.ts.
   */
  describe('enrichment traceability: paid work must appear (live path)', () => {
    const VISION_SENTINEL = 'SENTINEL_VISION_a7f3c9';
    const TRANSCRIPT_SENTINEL = 'SENTINEL_TRANSCRIPT_b2e8d1';

    function refWithImage(overrides: Partial<ReferencedMessage> = {}): ReferencedMessage {
      return {
        referenceNumber: 1,
        discordMessageId: 'msg-1',
        discordUserId: 'user-1',
        authorUsername: 'testuser',
        authorDisplayName: 'Test User',
        content: 'look at this',
        embeds: '',
        timestamp: '2025-12-06T00:00:00Z',
        locationContext: '',
        attachments: [
          {
            url: 'https://cdn.example.com/embed-image-1.png',
            contentType: 'image/png',
            name: 'embed-image-1.png',
            size: 1000,
          },
        ],
        ...overrides,
      };
    }

    /** One vision description, already produced by the dependency stage. */
    const preprocessedImage = {
      1: [
        {
          type: AttachmentType.Image,
          description: VISION_SENTINEL,
          originalUrl: 'https://cdn.example.com/embed-image-1.png',
          metadata: {
            url: 'https://cdn.example.com/embed-image-1.png',
            name: 'embed-image-1.png',
            contentType: 'image/png',
            size: 1000,
          },
        },
      ],
    };

    it.each([
      ['a full reference', false],
      ['a DEDUPED reference', true],
    ])('renders a preprocessed vision description into %s', async (_label, isDeduplicated) => {
      const { formatted, searchText } = await formatter.formatReferencedMessages(
        // The stub builder strips `attachments`, so the deduped case models the
        // real wire shape: descriptions arrive ONLY via preprocessing.
        [refWithImage(isDeduplicated ? { isDeduplicated: true, attachments: undefined } : {})],
        mockPersonality,
        false,
        preprocessedImage
      );

      expect(formatted).toContain(VISION_SENTINEL);
      // Retrieval sees it too — history has no copy of a description to match on.
      expect(searchText).toContain(VISION_SENTINEL);
      // ...and no new spend was incurred to get it there.
      expect(mockDescribeImage).not.toHaveBeenCalled();
    });

    it('renders a preprocessed voice transcript into a deduped reference', async () => {
      const { formatted } = await formatter.formatReferencedMessages(
        [refWithImage({ isDeduplicated: true, attachments: undefined, content: '' })],
        mockPersonality,
        false,
        {
          1: [
            {
              type: AttachmentType.Audio,
              description: TRANSCRIPT_SENTINEL,
              originalUrl: 'https://cdn.example.com/voice.ogg',
              metadata: {
                url: 'https://cdn.example.com/voice.ogg',
                name: 'voice.ogg',
                contentType: 'audio/ogg',
                size: 2000,
                duration: 6,
              },
            },
          ],
        }
      );

      // Duration rides along on THIS path too. Of the voice-rendering call
      // sites, this deduped one was the last to still drop it — the fixture had
      // no `duration` at all, so nothing would have caught the field being
      // wired up wrong in either direction.
      expect(formatted).toContain('<voice filename="voice.ogg" duration="6s">');
      expect(formatted).toContain(TRANSCRIPT_SENTINEL);
      // NOT the synthesized `audio/unknown` the dependency step stamps on
      // preprocessed metadata — a placeholder must not render as fact.
      expect(formatted).not.toContain('type="audio/unknown"');
      expect(mockTranscribeAudio).not.toHaveBeenCalled();
    });

    it('pairs the count: every description handed in comes back out', async () => {
      const descriptions = ['SENTINEL_ONE', 'SENTINEL_TWO', 'SENTINEL_THREE'];
      const { formatted } = await formatter.formatReferencedMessages(
        [refWithImage({ isDeduplicated: true, attachments: undefined })],
        mockPersonality,
        false,
        {
          1: descriptions.map((description, i) => ({
            type: AttachmentType.Image,
            description,
            originalUrl: `https://cdn.example.com/img-${i}.png`,
            metadata: {
              url: `https://cdn.example.com/img-${i}.png`,
              name: `img-${i}.png`,
              contentType: 'image/png',
              size: 1000,
            },
          })),
        }
      );

      for (const description of descriptions) {
        expect(formatted).toContain(description);
      }
      expect(formatted.match(/<image filename=/g)).toHaveLength(descriptions.length);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('warns when enrichment with real content reaches the renderer and is dropped', async () => {
      // The tripwire itself, modelled on the shape it exists to catch: a result
      // carrying a real description that the splitter has no arm for. That is
      // what a THIRD enrichment type would look like on the day it is added and
      // the deduped branch is not taught about it — work computed, work
      // discarded — and the silence around it was why a human was the only
      // detector the first two times.
      //
      // The cast is the point: every `AttachmentType` that exists today either
      // renders (Image, Audio) or is deliberately excluded from the denominator
      // (File — a free stub, not paid work), so the unhandled arm is not
      // otherwise constructible. Pinning it now means the warn is proven to
      // fire before anyone needs it to.
      await formatter.formatReferencedMessages(
        [refWithImage({ isDeduplicated: true, attachments: undefined })],
        mockPersonality,
        false,
        {
          1: [
            {
              type: 'video' as AttachmentType,
              description: 'a clip the splitter cannot render yet',
              originalUrl: 'https://cdn.example.com/clip.mp4',
              metadata: {
                url: 'https://cdn.example.com/clip.mp4',
                name: 'clip.mp4',
                contentType: 'video/mp4',
                size: 1000,
              },
            } satisfies ProcessedAttachment,
          ],
        },
        // The correlation id the warning is close to useless without: the counts
        // say enrichment was lost, this says which request lost it.
        { requestId: 'req-dropped-7' }
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-dropped-7',
          referenceNumber: 1,
          renderable: 1,
          rendered: 0,
        }),
        expect.stringContaining('not reaching the prompt')
      );
    });

    it('forwards the request id to the durable writer, so its keyless warn is correlated too', async () => {
      // The seam this pins is the formatter → toStoredReference hop: the second
      // warning about lost paid work lives inside the durable writer, and a
      // correlation id that reaches only the renderer's own warn leaves that one
      // anonymous. Modelled on the reachable shape — a transcription result the
      // dependency step could not key by URL (`originalUrl: ''`), which renders
      // fine for this turn and cannot be persisted for the next.
      await formatter.formatReferencedMessages(
        [refWithImage({ isDeduplicated: true, attachments: undefined })],
        mockPersonality,
        false,
        {
          1: [
            {
              type: AttachmentType.Audio,
              description: TRANSCRIPT_SENTINEL,
              originalUrl: '',
              metadata: {
                url: '',
                name: 'voice-message.ogg',
                contentType: 'audio/ogg',
                size: 1000,
              },
            } satisfies ProcessedAttachment,
          ],
        },
        { requestId: 'req-keyless-11' }
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req-keyless-11', kind: 'voice' }),
        expect.stringContaining('no attachment URL')
      );
    });

    it('forwards the request id into the live attachment path, so its logs correlate too', async () => {
      // The third correlation seam, and the only one on the COMPUTING arm: the
      // deduped arm's two warnings are correlated above, but a full reference
      // reaches vision and transcription through processAttachmentsParallel,
      // where every failure line is about work that was actually paid for. This
      // runs the real chain (AttachmentProcessor is not mocked here), so the
      // binding is observed where it lands rather than at a mocked call's args.
      mockDescribeImage.mockResolvedValue(VISION_SENTINEL);

      await formatter.formatReferencedMessages(
        [refWithImage()],
        mockPersonality,
        false,
        undefined,
        {
          requestId: 'req-live-3',
        }
      );

      expect(mockLogger.child).toHaveBeenCalledWith({ requestId: 'req-live-3' });
      // Bound, and actually used — a child nobody logs through correlates nothing.
      expect(mockChildLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ referenceNumber: 1 }),
        'Processing image (inline fallback)'
      );
    });

    it('stays silent when a transcription legitimately produces nothing', async () => {
      // A silent audio clip transcribes to '' on SUCCESS. Nothing was dropped,
      // so the tripwire must not fire — otherwise ordinary traffic generates
      // warn noise and the signal that matters gets tuned out.
      await formatter.formatReferencedMessages(
        [refWithImage({ isDeduplicated: true, attachments: undefined })],
        mockPersonality,
        false,
        {
          1: [
            {
              type: AttachmentType.Audio,
              description: '',
              originalUrl: 'https://cdn.example.com/silence.ogg',
              metadata: {
                url: 'https://cdn.example.com/silence.ogg',
                name: 'silence.ogg',
                contentType: 'audio/ogg',
                size: 500,
              },
            },
          ],
        }
      );

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    /**
     * The other half of "paid work must appear": work that was never paid for
     * must not be reported as missing.
     *
     * An attachment with no content processor comes back as a File-typed
     * result carrying a locally-generated "not supported" stub. It renders as a
     * bare <file/> — `RenderableFile` has no enrichment slot by design — so
     * counting the stub as available enrichment would make the drop tripwire
     * fire on any deduped quote of a video or a document, naming
     * vision/transcription spend that never happened.
     */
    describe('file stubs are identity-only, and never counted as paid work', () => {
      const FILE_STUB_DESCRIPTION =
        'Attachment type video/mp4 is not supported — content not analyzed';

      /** The shape MultimodalProcessor returns for an unprocessable type. */
      function fileStubEntry(url: string, name: string): ProcessedAttachment {
        return {
          type: AttachmentType.File,
          description: FILE_STUB_DESCRIPTION,
          originalUrl: url,
          metadata: { url, name, contentType: 'video/mp4', size: 4000 },
        };
      }

      it('renders a correlated file entry as a bare <file/> without warning', async () => {
        const url = 'https://cdn.example.com/clip.mp4';
        const { formatted } = await formatter.formatReferencedMessages(
          [
            refWithImage({
              isDeduplicated: true,
              attachments: [{ url, contentType: 'video/mp4', name: 'clip.mp4', size: 4000 }],
            }),
          ],
          mockPersonality,
          false,
          { 1: [fileStubEntry(url, 'clip.mp4')] }
        );

        // Identity from the reference's own attachment row, which carries the
        // real content type.
        expect(formatted).toContain('<file filename="clip.mp4" type="video/mp4"/>');
        expect(formatted).not.toContain(FILE_STUB_DESCRIPTION);
        expect(mockLogger.warn).not.toHaveBeenCalled();
      });

      it('renders an ORPHANED file entry rather than dropping it', async () => {
        // No attachment row correlates, so the entry falls to the orphan loop —
        // where a File used to have no arm and vanished from the quote entirely.
        const { formatted } = await formatter.formatReferencedMessages(
          [refWithImage({ isDeduplicated: true, attachments: undefined })],
          mockPersonality,
          false,
          { 1: [fileStubEntry('https://cdn.example.com/orphan.mp4', 'orphan.mp4')] }
        );

        expect(formatted).toContain('<file filename="orphan.mp4"/>');
        expect(formatted).not.toContain(FILE_STUB_DESCRIPTION);
        expect(mockLogger.warn).not.toHaveBeenCalled();
      });

      it('excludes only the file stub from the denominator — a real drop still warns', async () => {
        // Both in one reference: the tripwire must subtract the stub and still
        // count the unrenderable paid result. `renderable: 1`, not 2.
        await formatter.formatReferencedMessages(
          [refWithImage({ isDeduplicated: true, attachments: undefined })],
          mockPersonality,
          false,
          {
            1: [
              fileStubEntry('https://cdn.example.com/orphan.mp4', 'orphan.mp4'),
              {
                type: 'video' as AttachmentType,
                description: 'a clip the splitter cannot render yet',
                originalUrl: 'https://cdn.example.com/clip.mkv',
                metadata: {
                  url: 'https://cdn.example.com/clip.mkv',
                  name: 'clip.mkv',
                  contentType: 'video/x-matroska',
                  size: 1000,
                },
              } satisfies ProcessedAttachment,
            ],
          }
        );

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ referenceNumber: 1, renderable: 1, rendered: 0 }),
          expect.stringContaining('not reaching the prompt')
        );
      });
    });
  });
});
