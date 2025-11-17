/**
 * Tests for PromptBuilder
 *
 * Comprehensive test coverage for prompt building, including:
 * - Search query building with attachments
 * - Human message construction
 * - System prompt assembly with personality
 * - Token counting utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { PromptBuilder } from './PromptBuilder.js';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import type {
  MemoryDocument,
  DiscordEnvironment,
  ConversationContext,
} from './ConversationalRAGService.js';

// Mock the dependencies
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    getConfig: () => ({
      NODE_ENV: 'test',
    }),
    countTextTokens: vi.fn((text: string) => Math.ceil(text.length / 4)), // Mock: ~4 chars per token
  };
});

vi.mock('../utils/promptPlaceholders.js', () => ({
  replacePromptPlaceholders: vi.fn((text: string) => text.replace('{user}', 'TestUser').replace('{assistant}', 'TestBot')),
}));

describe('PromptBuilder', () => {
  let promptBuilder: PromptBuilder;

  beforeEach(() => {
    promptBuilder = new PromptBuilder();
    vi.clearAllMocks();
  });

  describe('buildSearchQuery', () => {
    it('should return userMessage when no attachments', () => {
      const result = promptBuilder.buildSearchQuery('Hello world', []);
      expect(result).toBe('Hello world');
    });

    it('should use transcription for voice-only messages (userMessage="Hello")', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: 'audio',
          description: 'This is a voice transcription',
          url: 'https://example.com/audio.mp3',
        },
      ];

      const result = promptBuilder.buildSearchQuery('Hello', attachments);
      expect(result).toBe('This is a voice transcription');
    });

    it('should combine text with attachment descriptions', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: 'image',
          description: 'A beautiful sunset',
          url: 'https://example.com/image.jpg',
        },
      ];

      const result = promptBuilder.buildSearchQuery('Look at this!', attachments);
      expect(result).toBe('Look at this!\n\nA beautiful sunset');
    });

    it('should use descriptions only when userMessage is empty', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: 'image',
          description: 'An image description',
          url: 'https://example.com/image.jpg',
        },
      ];

      const result = promptBuilder.buildSearchQuery('', attachments);
      expect(result).toBe('An image description');
    });

    it('should filter out placeholder descriptions starting with [', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: 'image',
          description: 'Real description',
          url: 'https://example.com/image1.jpg',
        },
        {
          type: 'image',
          description: '[Placeholder: image pending]',
          url: 'https://example.com/image2.jpg',
        },
      ];

      const result = promptBuilder.buildSearchQuery('Test', attachments);
      expect(result).toBe('Test\n\nReal description');
    });

    it('should handle multiple attachments', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: 'image',
          description: 'First image',
          url: 'https://example.com/1.jpg',
        },
        {
          type: 'image',
          description: 'Second image',
          url: 'https://example.com/2.jpg',
        },
      ];

      const result = promptBuilder.buildSearchQuery('Check these out', attachments);
      expect(result).toBe('Check these out\n\nFirst image\n\nSecond image');
    });
  });

  describe('buildHumanMessage', () => {
    it('should create simple text message', () => {
      const result = promptBuilder.buildHumanMessage('Hello world', []);

      expect(result.message).toBeInstanceOf(HumanMessage);
      expect(result.message.content).toBe('Hello world');
      expect(result.contentForStorage).toBe('Hello world');
    });

    it('should use transcription for voice messages', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: 'audio',
          description: 'Voice transcription here',
          url: 'https://example.com/audio.mp3',
        },
      ];

      const result = promptBuilder.buildHumanMessage('Hello', attachments);

      expect(result.message.content).toBe('Voice transcription here');
      expect(result.contentForStorage).toBe('Voice transcription here');
    });

    it('should combine text with attachment descriptions', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: 'image',
          description: 'Image description',
          url: 'https://example.com/image.jpg',
        },
      ];

      const result = promptBuilder.buildHumanMessage('Look at this', attachments);

      expect(result.message.content).toBe('Look at this\n\nImage description');
      expect(result.contentForStorage).toBe('Look at this\n\nImage description');
    });

    it('should append referenced messages', () => {
      const references = '**Referenced Message**: Some earlier message';
      const result = promptBuilder.buildHumanMessage('Reply text', [], undefined, references);

      expect(result.message.content).toBe('Reply text\n\n**Referenced Message**: Some earlier message');
      expect(result.contentForStorage).toBe('Reply text\n\n**Referenced Message**: Some earlier message');
    });

    it('should add current message header when activePersonaName provided', () => {
      const result = promptBuilder.buildHumanMessage('Hello', [], 'Alice');

      // Message should have header
      expect(result.message.content).toContain('## Current Message');
      expect(result.message.content).toContain('You are now responding to: **Alice**');
      expect(result.message.content).toContain('Hello');

      // Storage should NOT have header
      expect(result.contentForStorage).toBe('Hello');
      expect(result.contentForStorage).not.toContain('## Current Message');
    });

    it('should not add header when activePersonaName is empty', () => {
      const result = promptBuilder.buildHumanMessage('Hello', [], '');

      expect(result.message.content).toBe('Hello');
      expect(result.message.content).not.toContain('## Current Message');
    });

    it('should handle complex combination: attachments + references + activePersona', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: 'image',
          description: 'An image',
          url: 'https://example.com/img.jpg',
        },
      ];
      const references = '**Ref**: Earlier message';

      const result = promptBuilder.buildHumanMessage('My text', attachments, 'Bob', references);

      // Message has header
      expect(result.message.content).toContain('## Current Message');
      expect(result.message.content).toContain('Bob');

      // Storage doesn't have header but has everything else
      expect(result.contentForStorage).toBe('My text\n\nAn image\n\n**Ref**: Earlier message');
      expect(result.contentForStorage).not.toContain('## Current Message');
    });
  });

  describe('buildFullSystemPrompt', () => {
    const minimalPersonality: LoadedPersonality = {
      id: 'test-1',
      slug: 'test',
      name: 'TestBot',
      systemPrompt: 'You are a helpful assistant.',
      characterInfo: 'A test character',
      personalityTraits: 'Friendly and helpful',
      displayName: 'Test Bot',
      ownerId: 'owner-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const minimalContext: ConversationContext = {
      conversationId: 'conv-1',
      channelId: 'channel-1',
      activePersonaName: 'User',
    };

    it('should create basic system prompt with minimal personality', () => {
      const result = promptBuilder.buildFullSystemPrompt(
        minimalPersonality,
        new Map(),
        [],
        minimalContext
      );

      expect(result).toBeInstanceOf(SystemMessage);
      const content = result.content as string;

      // Should contain core sections
      expect(content).toContain('You are a helpful assistant');
      expect(content).toContain('## Your Identity');
      expect(content).toContain('You are Test Bot');
      expect(content).toContain('## Character Information');
      expect(content).toContain('A test character');
      expect(content).toContain('## Personality Traits');
      expect(content).toContain('Friendly and helpful');
      expect(content).toContain('## Current Context');
      expect(content).toContain('Current date and time:');
    });

    it('should include all personality fields when present', () => {
      const fullPersonality: LoadedPersonality = {
        ...minimalPersonality,
        personalityTone: 'Casual and friendly',
        personalityAge: '25 years old',
        personalityAppearance: 'Tall with blue eyes',
        personalityLikes: 'Coding and music',
        personalityDislikes: 'Bugs and deadlines',
        conversationalGoals: 'Help users learn',
        conversationalExamples: 'Example: "How can I help?"',
      };

      const result = promptBuilder.buildFullSystemPrompt(
        fullPersonality,
        new Map(),
        [],
        minimalContext
      );

      const content = result.content as string;

      expect(content).toContain('## Conversational Tone');
      expect(content).toContain('Casual and friendly');
      expect(content).toContain('## Age');
      expect(content).toContain('25 years old');
      expect(content).toContain('## Physical Appearance');
      expect(content).toContain('Tall with blue eyes');
      expect(content).toContain('## What I Like');
      expect(content).toContain('Coding and music');
      expect(content).toContain('## What I Dislike');
      expect(content).toContain('Bugs and deadlines');
      expect(content).toContain('## Conversational Goals');
      expect(content).toContain('Help users learn');
      expect(content).toContain('## Conversational Examples');
      expect(content).toContain('How can I help?');
    });

    it('should include conversation participants', () => {
      const participants = new Map([
        ['Alice', { content: 'A software developer', isActive: true }],
        ['Bob', { content: 'A designer', isActive: false }],
      ]);

      const result = promptBuilder.buildFullSystemPrompt(
        minimalPersonality,
        participants,
        [],
        minimalContext
      );

      const content = result.content as string;

      expect(content).toContain('## Conversation Participants');
      expect(content).toContain('### Alice');
      expect(content).toContain('A software developer');
      expect(content).toContain('### Bob');
      expect(content).toContain('A designer');
      expect(content).toContain('Note: This is a group conversation');
    });

    it('should show singular form for single participant', () => {
      const participants = new Map([
        ['Alice', { content: 'A software developer', isActive: true }],
      ]);

      const result = promptBuilder.buildFullSystemPrompt(
        minimalPersonality,
        participants,
        [],
        minimalContext
      );

      const content = result.content as string;

      expect(content).toContain('person is involved');
      expect(content).not.toContain('Note: This is a group conversation');
    });

    it('should include relevant memories with timestamps', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'User likes pizza',
          metadata: {
            id: 'mem-1',
            createdAt: new Date('2024-01-15T12:00:00Z'),
          },
        },
        {
          pageContent: 'User dislikes spam',
          metadata: {
            id: 'mem-2',
            createdAt: new Date('2024-01-20T15:30:00Z'),
          },
        },
      ];

      const result = promptBuilder.buildFullSystemPrompt(
        minimalPersonality,
        new Map(),
        memories,
        minimalContext
      );

      const content = result.content as string;

      expect(content).toContain('## Relevant Memories');
      expect(content).toContain('User likes pizza');
      expect(content).toContain('User dislikes spam');
    });

    it('should include referenced messages when provided', () => {
      const references = '**Referenced**: Some earlier context';

      const result = promptBuilder.buildFullSystemPrompt(
        minimalPersonality,
        new Map(),
        [],
        minimalContext,
        references
      );

      const content = result.content as string;

      expect(content).toContain('**Referenced**: Some earlier context');
    });

    it('should include DM environment context', () => {
      const dmEnvironment: DiscordEnvironment = {
        type: 'dm',
        channel: {
          id: 'dm-1',
          name: 'Direct Message',
          type: 'DM',
        },
      };

      const contextWithEnv: ConversationContext = {
        ...minimalContext,
        environment: dmEnvironment,
      };

      const result = promptBuilder.buildFullSystemPrompt(
        minimalPersonality,
        new Map(),
        [],
        contextWithEnv
      );

      const content = result.content as string;

      expect(content).toContain('## Conversation Location');
      expect(content).toContain('Direct Message');
      expect(content).toContain('private one-on-one chat');
    });

    it('should include guild environment context', () => {
      const guildEnvironment: DiscordEnvironment = {
        type: 'guild',
        guild: {
          id: 'guild-1',
          name: 'Test Server',
        },
        channel: {
          id: 'channel-1',
          name: 'general',
          type: 'text',
        },
        category: {
          id: 'cat-1',
          name: 'Community',
        },
      };

      const contextWithEnv: ConversationContext = {
        ...minimalContext,
        environment: guildEnvironment,
      };

      const result = promptBuilder.buildFullSystemPrompt(
        minimalPersonality,
        new Map(),
        [],
        contextWithEnv
      );

      const content = result.content as string;

      expect(content).toContain('## Conversation Location');
      expect(content).toContain('Discord server');
      expect(content).toContain('**Server**: Test Server');
      expect(content).toContain('**Category**: Community');
      expect(content).toContain('**Channel**: #general');
    });

    it('should include thread context when in thread', () => {
      const threadEnvironment: DiscordEnvironment = {
        type: 'guild',
        guild: {
          id: 'guild-1',
          name: 'Test Server',
        },
        channel: {
          id: 'channel-1',
          name: 'general',
          type: 'text',
        },
        thread: {
          id: 'thread-1',
          name: 'Discussion Thread',
        },
      };

      const contextWithEnv: ConversationContext = {
        ...minimalContext,
        environment: threadEnvironment,
      };

      const result = promptBuilder.buildFullSystemPrompt(
        minimalPersonality,
        new Map(),
        [],
        contextWithEnv
      );

      const content = result.content as string;

      expect(content).toContain('**Thread**: Discussion Thread');
    });
  });

  describe('formatUserMessage', () => {
    const minimalContext: ConversationContext = {
      conversationId: 'conv-1',
      channelId: 'channel-1',
    };

    it('should format simple string message', () => {
      const result = promptBuilder.formatUserMessage('Hello world', minimalContext);
      expect(result).toBe('Hello world');
    });

    it('should add proxy message context', () => {
      const proxyContext: ConversationContext = {
        ...minimalContext,
        isProxyMessage: true,
        userName: 'Alice',
      };

      const result = promptBuilder.formatUserMessage('Test message', proxyContext);
      expect(result).toBe('[Message from Alice]\nTest message');
    });

    it('should handle object messages with content', () => {
      const message = { content: 'Object message' };
      const result = promptBuilder.formatUserMessage(message, minimalContext);
      expect(result).toBe('Object message');
    });

    it('should include referenced message context', () => {
      const message = {
        content: 'My reply',
        referencedMessage: {
          content: 'Original message',
          author: 'Bob',
        },
      };

      const result = promptBuilder.formatUserMessage(message, minimalContext);
      expect(result).toBe('[Replying to Bob: "Original message"]\nMy reply');
    });

    it('should note attachments', () => {
      const message = {
        content: 'Check this out',
        attachments: [
          { name: 'image.jpg' },
          { name: 'document.pdf' },
        ],
      };

      const result = promptBuilder.formatUserMessage(message, minimalContext);
      expect(result).toContain('Check this out');
      expect(result).toContain('[Attachment: image.jpg]');
      expect(result).toContain('[Attachment: document.pdf]');
    });

    it('should return "Hello" for empty/invalid messages', () => {
      expect(promptBuilder.formatUserMessage('', minimalContext)).toBe('Hello');
      expect(promptBuilder.formatUserMessage({}, minimalContext)).toBe('Hello');
    });
  });

  describe('countTokens', () => {
    it('should count tokens for text', () => {
      const result = promptBuilder.countTokens('This is a test message');
      expect(result).toBeGreaterThan(0);
      expect(typeof result).toBe('number');
    });
  });

  describe('countMemoryTokens', () => {
    it('should return 0 for empty memories', () => {
      const result = promptBuilder.countMemoryTokens([]);
      expect(result).toBe(0);
    });

    it('should count tokens for memories with timestamps', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'First memory',
          metadata: {
            createdAt: new Date('2024-01-15T12:00:00Z'),
          },
        },
        {
          pageContent: 'Second memory',
          metadata: {
            createdAt: new Date('2024-01-20T15:30:00Z'),
          },
        },
      ];

      const result = promptBuilder.countMemoryTokens(memories);
      expect(result).toBeGreaterThan(0);
    });

    it('should count tokens for memories without timestamps', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'Memory without timestamp',
          metadata: {},
        },
      ];

      const result = promptBuilder.countMemoryTokens(memories);
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('countAttachmentTokens', () => {
    it('should return 0 for no attachments', () => {
      const result = promptBuilder.countAttachmentTokens([]);
      expect(result).toBe(0);
    });

    it('should count tokens from attachment descriptions', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: 'image',
          description: 'A beautiful sunset over the ocean',
          url: 'https://example.com/sunset.jpg',
        },
        {
          type: 'image',
          description: 'A mountain landscape',
          url: 'https://example.com/mountain.jpg',
        },
      ];

      const result = promptBuilder.countAttachmentTokens(attachments);
      expect(result).toBeGreaterThan(0);
    });

    it('should filter out placeholder descriptions', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: 'image',
          description: 'Real description',
          url: 'https://example.com/image1.jpg',
        },
        {
          type: 'image',
          description: '[Placeholder]',
          url: 'https://example.com/image2.jpg',
        },
      ];

      const result = promptBuilder.countAttachmentTokens(attachments);
      // Should only count the real description
      expect(result).toBeGreaterThan(0);
    });
  });
});
