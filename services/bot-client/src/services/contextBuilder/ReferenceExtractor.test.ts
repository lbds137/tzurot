/**
 * Tests for ReferenceExtractor
 *
 * Tests extractReferencesAndMentions: weigh-in bypass, reference extraction,
 * mention resolution, and channel mention handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from 'discord.js';
import { Collection } from 'discord.js';
import type { ConversationMessage } from '@tzurot/common-types/types/conversationMessage';

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
vi.mock('@tzurot/common-types/constants/media', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/media')>(
    '@tzurot/common-types/constants/media'
  );
  return {
    ...actual,
    CONTENT_TYPES: { AUDIO_PREFIX: 'audio/' },
  };
});

vi.mock('@tzurot/common-types/constants/message', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/message')>(
    '@tzurot/common-types/constants/message'
  );
  return {
    ...actual,
    MessageRole: { Assistant: 'assistant', User: 'user' },
    MESSAGE_LIMITS: { DEFAULT_MAX_MESSAGES: 50 },
  };
});

vi.mock('@tzurot/common-types/constants/timing', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/timing')>(
    '@tzurot/common-types/constants/timing'
  );
  return {
    ...actual,
    INTERVALS: { EMBED_PROCESSING_DELAY: 500 },
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

import { extractReferencesAndMentions } from './ReferenceExtractor.js';
import type { MentionResolver } from '../MentionResolver.js';

describe('extractReferencesAndMentions', () => {
  function createMockMessage(overrides?: Partial<Message>): Message {
    return {
      reference: null,
      attachments: new Collection(),
      ...overrides,
    } as unknown as Message;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // The real extractor always returns a string: the effective content with
    // Discord links rewritten to [Reference N]. With no links it echoes the
    // content unchanged.
    mockExtractReferences.mockResolvedValue({
      references: [],
      updatedContent: 'Hello world',
    });
    mockResolveAllMentions.mockReturnValue({
      processedContent: 'Hello world',
      mentionedUsers: [],
      mentionedChannels: [],
      mentionedRoles: [],
    });
  });

  it('captures raw envelope fields', async () => {
    mockExtractReferences.mockResolvedValue({
      references: [],
      updatedContent: 'Hello world',
      rawReferences: [{ referenceNumber: 1, content: 'raw snapshot' }],
    });
    mockResolveAllMentions.mockReturnValue({
      processedContent: 'rewritten',
      mentionedUsers: [],
      mentionedChannels: [{ channelId: '1', channelName: 'general', topic: 'chat', guildId: 'g1' }],
      mentionedRoles: [{ roleId: '2', roleName: 'mods', mentionable: true }],
    });

    const result = await extractReferencesAndMentions({
      mentionResolver: mockMentionResolver as unknown as MentionResolver,
      message: createMockMessage(),
      content: 'Hello world',
      history: [],
      maxReferences: 50,
    });

    expect(result.rawReferencedMessages).toEqual([{ referenceNumber: 1, content: 'raw snapshot' }]);
    expect(result.rawMentionedChannels).toEqual([
      { channelId: '1', channelName: 'general', topic: 'chat', guildId: 'g1' },
    ]);
    expect(result.rawMentionedRoles).toEqual([
      { roleId: '2', roleName: 'mods', mentionable: true },
    ]);
  });

  it('should return empty results in weigh-in mode', async () => {
    const result = await extractReferencesAndMentions({
      mentionResolver: mockMentionResolver as unknown as MentionResolver,
      message: createMockMessage(),
      content: 'Hello world',
      history: [],
      isWeighInMode: true,
      maxReferences: 50,
    });

    expect(result.messageContent).toBe('Hello world');
    expect(result.referencedMessages).toEqual([]);
    expect(mockExtractReferences).not.toHaveBeenCalled();
    expect(mockResolveAllMentions).not.toHaveBeenCalled();
  });

  it('should extract references and resolve mentions in normal mode', async () => {
    mockExtractReferences.mockResolvedValue({
      references: [{ referenceNumber: 1, content: 'quoted text', authorName: 'User' }],
      updatedContent: 'Hello [1]',
    });
    mockResolveAllMentions.mockReturnValue({
      processedContent: 'Hello [1]',
      mentionedUsers: [],
      mentionedChannels: [],
      mentionedRoles: [],
    });

    const result = await extractReferencesAndMentions({
      mentionResolver: mockMentionResolver as unknown as MentionResolver,
      message: createMockMessage(),
      content: 'Hello <link>',
      history: [],
      maxReferences: 50,
    });

    expect(result.messageContent).toBe('Hello [1]');
    expect(result.referencedMessages).toHaveLength(1);
  });

  it('returns empty messageContent when mention resolution drops non-empty content', async () => {
    // The forward-bug shape: authoritative `content` is non-empty, but the
    // rewrite pipeline (link replacement → mention resolution) yields empty
    // processed content. Content dropped by mention resolution must surface as
    // empty messageContent, never silently fall back to the original content.
    mockResolveAllMentions.mockReturnValue({
      processedContent: '',
      mentionedUsers: [],
      mentionedChannels: [],
      mentionedRoles: [],
    });

    const result = await extractReferencesAndMentions({
      mentionResolver: mockMentionResolver as unknown as MentionResolver,
      message: createMockMessage({ id: 'msg-forward' } as Partial<Message>),
      content: 'Forwarded message with real content',
      history: [],
      maxReferences: 50,
    });

    expect(result.messageContent).toBe('');
  });

  it('threads the effective content to the extractor so forward text is not clobbered', async () => {
    // Forward-bug regression guard: a forwarded message has empty top-level
    // content but non-empty effective content (extracted from the snapshot).
    // The extractor must receive the effective content (not message.content),
    // and link replacement over it must preserve the text — never collapse to
    // empty by formatting the empty top-level content.
    const effectiveContent = 'Forwarded snapshot text the user actually sent';
    mockExtractReferences.mockResolvedValue({
      references: [],
      updatedContent: effectiveContent, // no links → echoed unchanged
    });
    mockResolveAllMentions.mockReturnValue({
      processedContent: effectiveContent,
      mentionedUsers: [],
      mentionedChannels: [],
      mentionedRoles: [],
    });

    const message = createMockMessage({ id: 'forward-1', content: '' } as Partial<Message>);
    const result = await extractReferencesAndMentions({
      mentionResolver: mockMentionResolver as unknown as MentionResolver,
      message,
      content: effectiveContent,
      history: [],
      maxReferences: 50,
    });

    expect(mockExtractReferences).toHaveBeenCalledWith(message, effectiveContent);
    expect(result.messageContent).toBe(effectiveContent);
  });

  it('should call reference extractor in normal mode', async () => {
    const history: ConversationMessage[] = [
      { discordMessageId: ['msg-1', 'msg-2'], createdAt: new Date() } as ConversationMessage,
      { discordMessageId: ['msg-3'], createdAt: new Date() } as ConversationMessage,
    ];

    await extractReferencesAndMentions({
      mentionResolver: mockMentionResolver as unknown as MentionResolver,
      message: createMockMessage(),
      content: 'Hello',
      history,
      maxReferences: 50,
    });

    // The reference extractor should have been instantiated and called
    expect(mockExtractReferences).toHaveBeenCalled();
  });
});
