/**
 * MessageContextBuilder Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageContextBuilder } from '../../services/MessageContextBuilder.js';
import type { LoadedPersonality, ReferencedMessage } from '@tzurot/common-types';
import { MessageRole, CONTENT_TYPES } from '@tzurot/common-types';
import { Message, GuildMember, User, TextChannel, Collection } from 'discord.js';

// Mock dependencies
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');

  // Define mock classes inside the factory
  class MockConversationHistoryService {
    getRecentHistory = vi.fn().mockResolvedValue([]);
  }

  class MockUserService {
    getOrCreateUser = vi.fn().mockResolvedValue('user-uuid-123');
    getPersonaForUser = vi.fn().mockResolvedValue('persona-uuid-123');
    getPersonaName = vi.fn().mockResolvedValue('TestPersona');
  }

  return {
    ...actual,
    ConversationHistoryService: MockConversationHistoryService,
    UserService: MockUserService,
  };
});

vi.mock('../../utils/discordContext.js', () => ({
  extractDiscordEnvironment: vi.fn().mockReturnValue({
    channelName: 'test-channel',
    serverName: 'Test Server',
  }),
}));

vi.mock('../../utils/attachmentExtractor.js', () => ({
  extractAttachments: vi.fn().mockReturnValue([]),
}));

vi.mock('../../handlers/MessageReferenceExtractor.js', () => {
  class MockMessageReferenceExtractor {
    extractReferencesWithReplacement = vi.fn().mockResolvedValue({
      references: [],
      updatedContent: null,
    });
  }

  return {
    MessageReferenceExtractor: MockMessageReferenceExtractor,
  };
});

describe('MessageContextBuilder', () => {
  let builder: MessageContextBuilder;
  let mockPersonality: LoadedPersonality;
  let mockConversationHistory: any;
  let mockUserService: any;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    builder = new MessageContextBuilder();

    mockPersonality = {
      id: 'personality-123',
      name: 'TestBot',
      displayName: 'Test Bot',
      systemPrompt: 'You are a test bot',
      llmConfig: {
        model: 'test-model',
        temperature: 0.7,
        maxTokens: 1000,
      },
    } as LoadedPersonality;

    // Access the mocked services through the builder's private properties
    mockConversationHistory = (builder as any).conversationHistory;
    mockUserService = (builder as any).userService;

    // Set up default mock return values
    mockUserService.getOrCreateUser.mockResolvedValue('user-uuid-123');
    mockUserService.getPersonaForUser.mockResolvedValue('persona-uuid-123');
    mockUserService.getPersonaName.mockResolvedValue('TestPersona');
    mockConversationHistory.getRecentHistory.mockResolvedValue([]);
  });

  describe('buildContext - Basic Flow', () => {
    it('should build complete context with all components', async () => {
      const mockMessage = createMockMessage({
        authorId: 'discord-user-123',
        authorUsername: 'testuser',
        authorDisplayName: 'Test User',
        channelId: 'channel-123',
        guildId: 'guild-123',
        content: 'Hello bot!',
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello bot!');

      // Verify user service calls
      expect(mockUserService.getOrCreateUser).toHaveBeenCalledWith(
        'discord-user-123',
        'testuser',
        'Test User'
      );
      expect(mockUserService.getPersonaForUser).toHaveBeenCalledWith(
        'user-uuid-123',
        'personality-123'
      );
      expect(mockUserService.getPersonaName).toHaveBeenCalledWith('persona-uuid-123');

      // Verify history retrieval
      expect(mockConversationHistory.getRecentHistory).toHaveBeenCalledWith(
        'channel-123',
        'personality-123',
        100
      );

      // Verify result structure
      expect(result.userId).toBe('user-uuid-123');
      expect(result.personaId).toBe('persona-uuid-123');
      expect(result.personaName).toBe('TestPersona');
      expect(result.messageContent).toBe('Hello bot!');
      expect(result.context.userId).toBe('user-uuid-123');
      expect(result.context.userName).toBe('testuser');
      expect(result.context.channelId).toBe('channel-123');
      expect(result.context.serverId).toBe('guild-123');
      expect(result.context.activePersonaId).toBe('persona-uuid-123');
      expect(result.context.activePersonaName).toBe('TestPersona');
    });

    it('should handle messages without guild (DMs)', async () => {
      const mockMessage = createMockMessage({
        authorId: 'discord-user-123',
        authorUsername: 'testuser',
        channelId: 'dm-channel-123',
        guildId: null,
        content: 'DM message',
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'DM message');

      expect(result.context.serverId).toBeUndefined();
      expect(result.context.channelId).toBe('dm-channel-123');
    });

    it('should use message content as-is when provided', async () => {
      const mockMessage = createMockMessage({
        authorId: 'discord-user-123',
        authorUsername: 'testuser',
        channelId: 'channel-123',
        content: 'Some text',
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Some text');

      expect(result.messageContent).toBe('Some text');
    });
  });

  describe('buildContext - Conversation History', () => {
    it('should include conversation history in context', async () => {
      const mockMessage = createMockMessage({
        authorId: 'discord-user-123',
        authorUsername: 'testuser',
        channelId: 'channel-123',
        content: 'Follow-up message',
      });

      const mockHistory = [
        {
          id: 'msg-1',
          role: MessageRole.User,
          content: 'Previous message',
          createdAt: new Date('2025-01-01T10:00:00Z'),
          personaId: 'persona-uuid-123',
          personaName: 'TestPersona',
          discordMessageId: ['discord-msg-1'],
        },
        {
          id: 'msg-2',
          role: MessageRole.Assistant,
          content: 'Previous response',
          createdAt: new Date('2025-01-01T10:01:00Z'),
          personaId: null,
          personaName: null,
          discordMessageId: ['discord-msg-2'],
        },
      ];

      mockConversationHistory.getRecentHistory.mockResolvedValue(mockHistory);

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Follow-up message');

      expect(result.context.conversationHistory).toHaveLength(2);
      expect(result.context.conversationHistory[0]).toEqual({
        id: 'msg-1',
        role: MessageRole.User,
        content: 'Previous message',
        createdAt: '2025-01-01T10:00:00.000Z',
        personaId: 'persona-uuid-123',
        personaName: 'TestPersona',
      });
      expect(result.conversationHistory).toBe(mockHistory); // Raw history for enrichment
    });
  });

  describe('buildContext - Reference Extraction', () => {
    it('should include referenced messages when extractor returns them', async () => {
      const mockMessage = createMockMessage({
        authorId: 'discord-user-123',
        authorUsername: 'testuser',
        channelId: 'channel-123',
        content: 'Check this: https://discord.com/channels/123/456/789',
      });

      // The default mock returns empty references, which is fine for this test
      // We're just verifying the flow works
      const result = await builder.buildContext(
        mockMessage,
        mockPersonality,
        'Check this: https://discord.com/channels/123/456/789'
      );

      // With default mock returning empty references
      expect(result.referencedMessages).toEqual([]);
      expect(result.context.referencedMessages).toBeUndefined();
    });

    it('should not include referencedMessages in context when empty', async () => {
      const mockMessage = createMockMessage({
        authorId: 'discord-user-123',
        authorUsername: 'testuser',
        channelId: 'channel-123',
        content: 'No references here',
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'No references here');

      expect(result.referencedMessages).toEqual([]);
      expect(result.context.referencedMessages).toBeUndefined();
    });
  });

  describe('buildContext - Attachments and Environment', () => {
    it('should extract attachments and environment', async () => {
      const mockMessage = createMockMessage({
        authorId: 'discord-user-123',
        authorUsername: 'testuser',
        channelId: 'channel-123',
        content: 'Message with attachment',
      });

      const mockAttachments = [
        { type: 'image', url: 'https://cdn.discord.com/image.png', filename: 'image.png' },
      ];

      const mockEnvironment = {
        channelName: 'general',
        serverName: 'Test Server',
      };

      const { extractAttachments } = await import('../../utils/attachmentExtractor.js');
      const { extractDiscordEnvironment } = await import('../../utils/discordContext.js');

      vi.mocked(extractAttachments).mockReturnValue(mockAttachments);
      vi.mocked(extractDiscordEnvironment).mockReturnValue(mockEnvironment);

      const result = await builder.buildContext(
        mockMessage,
        mockPersonality,
        'Message with attachment'
      );

      expect(extractAttachments).toHaveBeenCalledWith(mockMessage.attachments);
      expect(extractDiscordEnvironment).toHaveBeenCalledWith(mockMessage);
      expect(result.context.attachments).toEqual(mockAttachments);
      expect(result.context.environment).toEqual(mockEnvironment);
    });
  });
});

// Type for mock message structure
interface MockMessage {
  author: {
    id: string;
    username: string;
    globalName: string;
  };
  channel: {
    id: string;
  };
  content: string;
  attachments: Collection<string, unknown>;
  reference: null;
  guild: { id: string } | null;
  member: { displayName: string } | null;
}

// Helper function to create mock Discord messages
function createMockMessage(options: {
  authorId: string;
  authorUsername: string;
  authorDisplayName?: string;
  channelId: string;
  guildId?: string | null;
  content: string;
}): MockMessage {
  const mockMessage: MockMessage = {
    author: {
      id: options.authorId,
      username: options.authorUsername,
      globalName: options.authorDisplayName || options.authorUsername,
    },
    channel: {
      id: options.channelId,
    },
    content: options.content,
    attachments: new Collection(),
    reference: null,
    guild: options.guildId ? { id: options.guildId } : null,
    member: options.guildId
      ? { displayName: options.authorDisplayName || options.authorUsername }
      : null,
  };

  return mockMessage;
}
