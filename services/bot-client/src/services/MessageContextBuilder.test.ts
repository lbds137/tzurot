/**
 * Tests for MessageContextBuilder
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageContextBuilder } from './MessageContextBuilder.js';
import type { PrismaClient } from '@tzurot/common-types';
import type {
  Message,
  Collection,
  Attachment,
  Guild,
  GuildMember,
  TextChannel,
  User,
} from 'discord.js';
import { MessageRole, CONTENT_TYPES } from '@tzurot/common-types';
import type { LoadedPersonality, ReferencedMessage } from '@tzurot/common-types';

// Mock dependencies
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    ConversationHistoryService: class {
      getRecentHistory = vi.fn();
    },
    UserService: class {
      getOrCreateUser = vi.fn();
      getPersonaForUser = vi.fn();
      getPersonaName = vi.fn();
    },
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

vi.mock('../utils/discordContext.js', () => ({
  extractDiscordEnvironment: vi.fn(() => ({
    guildName: 'Test Guild',
    channelName: 'general',
  })),
}));

vi.mock('../utils/attachmentExtractor.js', () => ({
  extractAttachments: vi.fn(() => []),
}));

// Create mock instance before mocking the module
const mockExtractReferencesWithReplacement = vi.fn();

vi.mock('../handlers/MessageReferenceExtractor.js', () => ({
  MessageReferenceExtractor: class {
    extractReferencesWithReplacement = mockExtractReferencesWithReplacement;
  },
}));

// Import after mocks
import { ConversationHistoryService, UserService } from '@tzurot/common-types';
import { extractDiscordEnvironment } from '../utils/discordContext.js';
import { extractAttachments } from '../utils/attachmentExtractor.js';
import { MessageReferenceExtractor } from '../handlers/MessageReferenceExtractor.js';

describe('MessageContextBuilder', () => {
  let builder: MessageContextBuilder;
  let mockPrisma: PrismaClient;
  let mockHistoryService: ConversationHistoryService;
  let mockUserService: UserService;
  let mockPersonality: LoadedPersonality;
  let mockMessage: Message;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock Prisma client
    mockPrisma = {} as PrismaClient;

    // Create builder instance
    builder = new MessageContextBuilder(mockPrisma);

    // Get service instances to access mocks
    mockHistoryService = (builder as any).conversationHistory;
    mockUserService = (builder as any).userService;

    // Mock personality
    mockPersonality = {
      id: 'personality-123',
      name: 'Test Bot',
      slug: 'test-bot',
      systemPrompt: 'You are a helpful assistant',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 2000,
    } as LoadedPersonality;

    // Create mock Discord message
    const mockAuthor = {
      id: 'user-123',
      username: 'testuser',
      globalName: 'Test User',
    } as User;

    const mockMember = {
      displayName: 'Test Display Name',
    } as GuildMember;

    const mockGuild = {
      id: 'guild-123',
      name: 'Test Guild',
    } as Guild;

    const mockChannel = {
      id: 'channel-123',
      name: 'general',
    } as TextChannel;

    // Create mock attachments Collection with Discord.js methods
    const mockAttachments = new Map() as Collection<string, Attachment>;
    (mockAttachments as any).some = function (callback: (value: Attachment) => boolean) {
      for (const value of this.values()) {
        if (callback(value)) return true;
      }
      return false;
    };

    // Create mock mentions.users Collection (empty by default)
    const mockMentionedUsers = new Map() as Collection<string, User>;

    mockMessage = {
      id: 'message-123',
      author: mockAuthor,
      member: mockMember,
      guild: mockGuild,
      channel: mockChannel,
      content: 'Hello world',
      attachments: mockAttachments,
      mentions: {
        users: mockMentionedUsers,
      },
      reference: null,
    } as Message;
  });

  describe('buildContext', () => {
    it('should build complete context with user lookup and history', async () => {
      // Setup mocks
      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getPersonaForUser).mockResolvedValue('persona-123');
      vi.mocked(mockUserService.getPersonaName).mockResolvedValue('Test Persona');
      vi.mocked(mockHistoryService.getRecentHistory).mockResolvedValue([
        {
          id: 'history-1',
          role: MessageRole.User,
          content: 'Previous message',
          createdAt: new Date('2025-01-01T00:00:00Z'),
          personaId: 'persona-123',
          personaName: 'Test Persona',
          discordMessageId: ['prev-msg-123'],
        },
      ]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello world',
      });

      // Execute
      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello world');

      // Verify user service calls
      expect(mockUserService.getOrCreateUser).toHaveBeenCalledWith(
        'user-123',
        'testuser',
        'Test Display Name'
      );
      expect(mockUserService.getPersonaForUser).toHaveBeenCalledWith(
        'user-uuid-123',
        'personality-123'
      );
      expect(mockUserService.getPersonaName).toHaveBeenCalledWith('persona-123');

      // Verify history retrieval
      expect(mockHistoryService.getRecentHistory).toHaveBeenCalledWith(
        'channel-123',
        'personality-123',
        100
      );

      // Verify context structure
      expect(result.context).toMatchObject({
        userId: 'user-uuid-123',
        userName: 'testuser',
        channelId: 'channel-123',
        serverId: 'guild-123',
        messageContent: 'Hello world',
        activePersonaId: 'persona-123',
        activePersonaName: 'Test Persona',
      });

      expect(result.context.conversationHistory).toHaveLength(1);
      expect(result.context.conversationHistory[0]).toMatchObject({
        role: MessageRole.User,
        content: 'Previous message',
      });

      // Verify return values
      expect(result.userId).toBe('user-uuid-123');
      expect(result.personaId).toBe('persona-123');
      expect(result.personaName).toBe('Test Persona');
      expect(result.messageContent).toBe('Hello world');
    });

    it('should handle user without display name', async () => {
      mockMessage.member = null;
      (mockMessage.author as any).globalName = null;

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getPersonaForUser).mockResolvedValue('persona-123');
      vi.mocked(mockUserService.getPersonaName).mockResolvedValue(null);
      vi.mocked(mockHistoryService.getRecentHistory).mockResolvedValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello');

      expect(mockUserService.getOrCreateUser).toHaveBeenCalledWith(
        'user-123',
        'testuser',
        'testuser' // Falls back to username
      );
      expect(result.context.activePersonaName).toBeUndefined();
    });

    it('should handle empty conversation history', async () => {
      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getPersonaForUser).mockResolvedValue('persona-123');
      vi.mocked(mockUserService.getPersonaName).mockResolvedValue('Test Persona');
      vi.mocked(mockHistoryService.getRecentHistory).mockResolvedValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'First message',
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'First message');

      expect(result.context.conversationHistory).toEqual([]);
      expect(result.conversationHistory).toEqual([]);
    });

    it('should extract and deduplicate referenced messages', async () => {
      const mockReferences: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          messageId: 'ref-msg-1',
          content: 'Referenced content',
          author: {
            id: 'author-1',
            username: 'refuser',
            displayName: 'Ref User',
          },
          timestamp: '2025-01-01T00:00:00Z',
          attachments: [],
        },
      ];

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getPersonaForUser).mockResolvedValue('persona-123');
      vi.mocked(mockUserService.getPersonaName).mockResolvedValue('Test Persona');
      vi.mocked(mockHistoryService.getRecentHistory).mockResolvedValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: mockReferences,
        updatedContent: 'Check [Reference 1]',
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Check this message');

      expect(result.referencedMessages).toHaveLength(1);
      expect(result.referencedMessages[0]).toMatchObject({
        referenceNumber: 1,
        content: 'Referenced content',
      });
      expect(result.messageContent).toBe('Check [Reference 1]');
      expect(result.context.referencedMessages).toEqual(mockReferences);
    });

    it('should extract conversation history message IDs for deduplication', async () => {
      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getPersonaForUser).mockResolvedValue('persona-123');
      vi.mocked(mockUserService.getPersonaName).mockResolvedValue('Test Persona');
      vi.mocked(mockHistoryService.getRecentHistory).mockResolvedValue([
        {
          id: 'history-1',
          role: MessageRole.User,
          content: 'Message 1',
          createdAt: new Date('2025-01-01T00:00:00Z'),
          personaId: 'persona-123',
          personaName: 'Test Persona',
          discordMessageId: ['discord-msg-1', 'discord-msg-2'],
        },
        {
          id: 'history-2',
          role: MessageRole.Assistant,
          content: 'Response',
          createdAt: new Date('2025-01-01T00:01:00Z'),
          personaId: 'persona-123',
          personaName: 'Test Persona',
          discordMessageId: ['discord-msg-3'],
        },
      ]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello');

      // Verify conversation history was retrieved
      expect(result.conversationHistory).toHaveLength(2);
      expect(result.conversationHistory[0].discordMessageId).toEqual([
        'discord-msg-1',
        'discord-msg-2',
      ]);
      expect(result.conversationHistory[1].discordMessageId).toEqual(['discord-msg-3']);
    });

    it('should extract attachments from message', async () => {
      const mockAttachments = [
        {
          url: 'https://example.com/image.png',
          filename: 'image.png',
          contentType: 'image/png',
        },
      ];

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getPersonaForUser).mockResolvedValue('persona-123');
      vi.mocked(mockUserService.getPersonaName).mockResolvedValue('Test Persona');
      vi.mocked(mockHistoryService.getRecentHistory).mockResolvedValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Check this image',
      });
      vi.mocked(extractAttachments).mockReturnValue(mockAttachments as any);

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Check this image');

      expect(extractAttachments).toHaveBeenCalledWith(mockMessage.attachments);
      expect(result.context.attachments).toEqual(mockAttachments);
    });

    it('should extract Discord environment context', async () => {
      const mockEnvironment = {
        guildName: 'Test Guild',
        channelName: 'general',
        channelType: 'text',
      };

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getPersonaForUser).mockResolvedValue('persona-123');
      vi.mocked(mockUserService.getPersonaName).mockResolvedValue('Test Persona');
      vi.mocked(mockHistoryService.getRecentHistory).mockResolvedValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });
      vi.mocked(extractDiscordEnvironment).mockReturnValue(mockEnvironment as any);

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello');

      expect(extractDiscordEnvironment).toHaveBeenCalledWith(mockMessage);
      expect(result.context.environment).toEqual(mockEnvironment);
    });

    it('should handle empty content with fallback', async () => {
      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getPersonaForUser).mockResolvedValue('persona-123');
      vi.mocked(mockUserService.getPersonaName).mockResolvedValue('Test Persona');
      vi.mocked(mockHistoryService.getRecentHistory).mockResolvedValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: null,
      });

      // Pass null for content to trigger fallback
      const result = await builder.buildContext(mockMessage, mockPersonality, null as any);

      expect(result.messageContent).toBe('[no text content]');
      expect(result.context.messageContent).toBe('[no text content]');
    });

    it('should handle voice message with reply deduplication logging', async () => {
      // Add voice attachment to message
      const voiceAttachment = {
        id: 'voice-123',
        url: 'https://example.com/voice.ogg',
        contentType: 'audio/ogg',
        duration: 5.2,
      } as Attachment;

      // Create Collection with .some() method
      const voiceAttachments = new Map([['voice-123', voiceAttachment]]) as Collection<
        string,
        Attachment
      >;
      (voiceAttachments as any).some = function (callback: (value: Attachment) => boolean) {
        for (const value of this.values()) {
          if (callback(value)) return true;
        }
        return false;
      };

      mockMessage.attachments = voiceAttachments;
      mockMessage.reference = {
        messageId: 'reply-to-msg',
      } as any;

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getPersonaForUser).mockResolvedValue('persona-123');
      vi.mocked(mockUserService.getPersonaName).mockResolvedValue('Test Persona');
      vi.mocked(mockHistoryService.getRecentHistory).mockResolvedValue([
        {
          id: 'history-1',
          role: MessageRole.Assistant,
          content: 'Recent response',
          createdAt: new Date('2025-01-01T00:00:00Z'),
          personaId: 'persona-123',
          personaName: 'Test Persona',
          discordMessageId: ['reply-to-msg'],
        },
      ]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Voice message',
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Voice message');

      // Should complete successfully with debug logging
      expect(result.context.messageContent).toBe('Voice message');
    });

    it('should not include referencedMessages in context when empty', async () => {
      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getPersonaForUser).mockResolvedValue('persona-123');
      vi.mocked(mockUserService.getPersonaName).mockResolvedValue('Test Persona');
      vi.mocked(mockHistoryService.getRecentHistory).mockResolvedValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello');

      expect(result.context.referencedMessages).toBeUndefined();
      expect(result.referencedMessages).toEqual([]);
    });
  });
});
