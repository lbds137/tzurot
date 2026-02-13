/**
 * Tests for ReferenceExtractor
 *
 * Tests extractReferencesAndMentions: weigh-in bypass, reference extraction,
 * mention resolution, and channel mention handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from 'discord.js';
import { Collection } from 'discord.js';
import type { ConversationMessage, LoadedPersonality, PrismaClient } from '@tzurot/common-types';

// Hoist mock so it's available before module loading
const { mockExtractReferences } = vi.hoisted(() => ({
  mockExtractReferences: vi.fn(),
}));

vi.mock('../../handlers/MessageReferenceExtractor.js', () => {
  return {
    MessageReferenceExtractor: class {
      extractReferencesWithReplacement = mockExtractReferences;
    },
  };
});

// Mock MentionResolver
const mockResolveAllMentions = vi.fn();
const mockMentionResolver = {
  resolveAllMentions: mockResolveAllMentions,
};

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    MessageRole: { Assistant: 'assistant', User: 'user' },
    CONTENT_TYPES: { AUDIO_PREFIX: 'audio/' },
    INTERVALS: { EMBED_PROCESSING_DELAY: 500 },
    MESSAGE_LIMITS: { DEFAULT_MAX_MESSAGES: 50 },
  };
});

import { extractReferencesAndMentions } from './ReferenceExtractor.js';
import type { MentionResolver } from '../MentionResolver.js';

describe('extractReferencesAndMentions', () => {
  const mockPrisma = {} as PrismaClient;
  const mockPersonality = { id: 'personality-1' } as LoadedPersonality;

  function createMockMessage(overrides?: Partial<Message>): Message {
    return {
      reference: null,
      attachments: new Collection(),
      ...overrides,
    } as unknown as Message;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractReferences.mockResolvedValue({
      references: [],
      updatedContent: undefined,
    });
    mockResolveAllMentions.mockResolvedValue({
      processedContent: 'Hello world',
      mentionedUsers: [],
      mentionedChannels: [],
    });
  });

  it('should return empty results in weigh-in mode', async () => {
    const result = await extractReferencesAndMentions({
      prisma: mockPrisma,
      mentionResolver: mockMentionResolver as unknown as MentionResolver,
      message: createMockMessage(),
      content: 'Hello world',
      personality: mockPersonality,
      history: [],
      isWeighInMode: true,
      maxReferences: 50,
    });

    expect(result.messageContent).toBe('Hello world');
    expect(result.referencedMessages).toEqual([]);
    expect(result.mentionedPersonas).toBeUndefined();
    expect(result.referencedChannels).toBeUndefined();
    expect(mockExtractReferences).not.toHaveBeenCalled();
    expect(mockResolveAllMentions).not.toHaveBeenCalled();
  });

  it('should extract references and resolve mentions in normal mode', async () => {
    mockExtractReferences.mockResolvedValue({
      references: [{ referenceNumber: 1, content: 'quoted text', authorName: 'User' }],
      updatedContent: 'Hello [1]',
    });
    mockResolveAllMentions.mockResolvedValue({
      processedContent: 'Hello [1]',
      mentionedUsers: [],
      mentionedChannels: [],
    });

    const result = await extractReferencesAndMentions({
      prisma: mockPrisma,
      mentionResolver: mockMentionResolver as unknown as MentionResolver,
      message: createMockMessage(),
      content: 'Hello <link>',
      personality: mockPersonality,
      history: [],
      maxReferences: 50,
    });

    expect(result.messageContent).toBe('Hello [1]');
    expect(result.referencedMessages).toHaveLength(1);
  });

  it('should include mentioned personas when present', async () => {
    mockResolveAllMentions.mockResolvedValue({
      processedContent: 'Hello @alice',
      mentionedUsers: [{ personaId: 'p-1', personaName: 'alice' }],
      mentionedChannels: [],
    });

    const result = await extractReferencesAndMentions({
      prisma: mockPrisma,
      mentionResolver: mockMentionResolver as unknown as MentionResolver,
      message: createMockMessage(),
      content: 'Hello @alice',
      personality: mockPersonality,
      history: [],
      maxReferences: 50,
    });

    expect(result.mentionedPersonas).toEqual([{ personaId: 'p-1', personaName: 'alice' }]);
  });

  it('should include referenced channels when present', async () => {
    mockResolveAllMentions.mockResolvedValue({
      processedContent: 'Check #general',
      mentionedUsers: [],
      mentionedChannels: [
        { channelId: 'ch-1', channelName: 'general', topic: 'Main chat', guildId: 'g-1' },
      ],
    });

    const result = await extractReferencesAndMentions({
      prisma: mockPrisma,
      mentionResolver: mockMentionResolver as unknown as MentionResolver,
      message: createMockMessage(),
      content: 'Check #general',
      personality: mockPersonality,
      history: [],
      maxReferences: 50,
    });

    expect(result.referencedChannels).toEqual([
      { channelId: 'ch-1', channelName: 'general', topic: 'Main chat', guildId: 'g-1' },
    ]);
  });

  it('should call reference extractor in normal mode', async () => {
    const history: ConversationMessage[] = [
      { discordMessageId: ['msg-1', 'msg-2'], createdAt: new Date() } as ConversationMessage,
      { discordMessageId: ['msg-3'], createdAt: new Date() } as ConversationMessage,
    ];

    await extractReferencesAndMentions({
      prisma: mockPrisma,
      mentionResolver: mockMentionResolver as unknown as MentionResolver,
      message: createMockMessage(),
      content: 'Hello',
      personality: mockPersonality,
      history,
      maxReferences: 50,
    });

    // The reference extractor should have been instantiated and called
    expect(mockExtractReferences).toHaveBeenCalled();
  });
});
