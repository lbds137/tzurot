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
import { MessageRole } from '@tzurot/common-types';
import type { LoadedPersonality, ReferencedMessage } from '@tzurot/common-types';

// Mock PersonaResolver
const mockPersonaResolver = {
  resolve: vi.fn(),
  resolveForMemory: vi.fn(),
  getPersonaContentForPrompt: vi.fn(),
  invalidateUserCache: vi.fn(),
  clearCache: vi.fn(),
  stopCleanup: vi.fn(),
};

// Mock dependencies
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    ConversationHistoryService: class {
      getRecentHistory = vi.fn();
      getChannelHistory = vi.fn();
    },
    UserService: class {
      getOrCreateUser = vi.fn();
      getOrCreateUsersInBatch = vi.fn().mockResolvedValue(new Map());
      getPersonaName = vi.fn();
      getUserTimezone = vi.fn();
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

// Mock redis since TranscriptRetriever imports it
vi.mock('../redis.js', () => ({
  redisService: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    expire: vi.fn(),
    setWithExpiry: vi.fn(),
  },
}));

vi.mock('../utils/attachmentExtractor.js', () => ({
  extractAttachments: vi.fn(() => []),
}));

// Create mock instance before mocking the module
const mockExtractReferencesWithReplacement = vi.fn();
const mockResolveMentions = vi.fn();
const mockResolveAllMentions = vi.fn();

vi.mock('../handlers/MessageReferenceExtractor.js', () => ({
  MessageReferenceExtractor: class {
    extractReferencesWithReplacement = mockExtractReferencesWithReplacement;
  },
}));

vi.mock('./MentionResolver.js', () => ({
  MentionResolver: class {
    resolveMentions = mockResolveMentions;
    resolveAllMentions = mockResolveAllMentions;
  },
}));

// Mock for DiscordChannelFetcher
const mockFetchRecentMessages = vi.fn();
const mockMergeWithHistory = vi.fn();

vi.mock('./DiscordChannelFetcher.js', () => ({
  DiscordChannelFetcher: class {
    fetchRecentMessages = mockFetchRecentMessages;
    mergeWithHistory = mockMergeWithHistory;
  },
}));

// Import after mocks
import { ConversationHistoryService, UserService } from '@tzurot/common-types';
import { extractDiscordEnvironment } from '../utils/discordContext.js';
import { extractAttachments } from '../utils/attachmentExtractor.js';
import { MessageReferenceExtractor as _MessageReferenceExtractor } from '../handlers/MessageReferenceExtractor.js';

describe('MessageContextBuilder', () => {
  let builder: MessageContextBuilder;
  let mockPrisma: PrismaClient;
  let mockHistoryService: ConversationHistoryService;
  let mockUserService: UserService;
  let mockPersonality: LoadedPersonality;
  let mockMessage: Message;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock Prisma client with userPersonaHistoryConfig
    mockPrisma = {
      userPersonaHistoryConfig: {
        findUnique: vi.fn().mockResolvedValue(null), // No epoch by default
      },
    } as unknown as PrismaClient;

    // Create builder instance with mock PersonaResolver
    builder = new MessageContextBuilder(mockPrisma, mockPersonaResolver as any);

    // Get service instances to access mocks
    mockHistoryService = (builder as any).conversationHistory;
    mockUserService = (builder as any).userService;

    // Default mock for PersonaResolver.resolve
    mockPersonaResolver.resolve.mockResolvedValue({
      config: {
        personaId: 'persona-123',
        preferredName: 'Test Persona',
        pronouns: null,
        content: '',
        shareLtmAcrossPersonalities: false,
      },
      source: 'user-default',
    });

    // Mock personality
    mockPersonality = {
      id: 'personality-123',
      name: 'Test Bot',
      displayName: 'Test Bot',
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
      bot: false,
    } as User;

    const mockMember = {
      displayName: 'Test Display Name',
    } as GuildMember;

    const mockGuild = {
      id: 'guild-123',
      name: 'Test Guild',
      members: {
        // Fetch returns the mockMember by default; tests can override
        fetch: vi.fn().mockResolvedValue(mockMember),
      },
    } as unknown as Guild;

    const mockChannel = {
      id: 'channel-123',
      name: 'general',
      type: 0, // GuildText channel type (ChannelType.GuildText)
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

    // Default mock for resolveAllMentions - returns unchanged content with empty arrays
    mockResolveAllMentions.mockResolvedValue({
      processedContent: 'Hello world',
      mentionedUsers: [],
      mentionedChannels: [],
      mentionedRoles: [],
    });
  });

  describe('buildContext', () => {
    it('should build complete context with user lookup and history', async () => {
      // Setup mocks
      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      // PersonaResolver.resolve is already mocked in beforeEach
      // PersonaResolver.resolve returns preferredName directly
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([
        {
          id: 'history-1',
          role: MessageRole.User,
          content: 'Previous message',
          createdAt: new Date('2025-01-01T00:00:00Z'),
          personaId: 'persona-123',
          personaName: 'Test Persona',
          discordUsername: 'prevuser', // Discord username for collision detection
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
        'Test Display Name',
        undefined, // bio
        false // isBot
      );
      // PersonaResolver uses Discord ID (not internal UUID)
      expect(mockPersonaResolver.resolve).toHaveBeenCalledWith(
        'user-123', // Discord ID
        'personality-123'
      );

      // Verify history retrieval (2nd arg is limit, 3rd is contextEpoch - undefined when no STM clear)
      expect(mockHistoryService.getChannelHistory).toHaveBeenCalledWith(
        'channel-123',
        100,
        undefined
      );

      // Verify context structure
      // Note: context.userId is the Discord ID (for BYOK), not the internal UUID
      expect(result.context).toMatchObject({
        userId: 'user-123', // Discord ID for BYOK resolution
        userName: 'testuser',
        discordUsername: 'testuser', // For name collision disambiguation
        channelId: 'channel-123',
        serverId: 'guild-123',
        messageContent: 'Hello world',
        activePersonaId: 'persona-123',
        activePersonaName: 'Test Persona',
      });

      expect(result.context.conversationHistory).toHaveLength(1);
      expect(result.context.conversationHistory![0]).toMatchObject({
        role: MessageRole.User,
        content: 'Previous message',
        discordUsername: 'prevuser', // Should be passed through for collision detection
      });

      // Verify return values
      expect(result.userId).toBe('user-uuid-123');
      expect(result.personaId).toBe('persona-123');
      expect(result.personaName).toBe('Test Persona');
      expect(result.messageContent).toBe('Hello world');
    });

    it('should handle user without display name', async () => {
      (mockMessage as any).member = null;
      (mockMessage.author as any).globalName = null;
      // Mock fetch to also return null (simulates member not fetchable)
      vi.mocked(mockMessage.guild!.members.fetch).mockResolvedValue(null as any);

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      // Override to return null preferredName
      mockPersonaResolver.resolve.mockResolvedValue({
        config: {
          personaId: 'persona-123',
          preferredName: null,
          pronouns: null,
          content: '',
          shareLtmAcrossPersonalities: false,
        },
        source: 'user-default',
      });
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello');

      expect(mockUserService.getOrCreateUser).toHaveBeenCalledWith(
        'user-123',
        'testuser',
        'testuser', // Falls back to username
        undefined, // bio
        false // isBot
      );
      expect(result.context.activePersonaName).toBeUndefined();
    });

    it('should handle empty conversation history', async () => {
      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      // PersonaResolver.resolve is already mocked in beforeEach
      // PersonaResolver.resolve returns preferredName directly
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([]);
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
          discordMessageId: 'ref-msg-1',
          discordUserId: 'author-1',
          authorUsername: 'refuser',
          authorDisplayName: 'Ref User',
          content: 'Referenced content',
          embeds: '',
          timestamp: '2025-01-01T00:00:00Z',
          locationContext: 'Test Server / #general',
        },
      ];

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      // PersonaResolver.resolve is already mocked in beforeEach
      // PersonaResolver.resolve returns preferredName directly
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: mockReferences,
        updatedContent: 'Check [Reference 1]',
      });
      mockResolveAllMentions.mockResolvedValue({
        processedContent: 'Check [Reference 1]',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
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
      // PersonaResolver.resolve is already mocked in beforeEach
      // PersonaResolver.resolve returns preferredName directly
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([
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
          name: 'image.png',
          contentType: 'image/png',
        },
      ];

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      // PersonaResolver.resolve is already mocked in beforeEach
      // PersonaResolver.resolve returns preferredName directly
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([]);
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
      // PersonaResolver.resolve is already mocked in beforeEach
      // PersonaResolver.resolve returns preferredName directly
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([]);
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
      // PersonaResolver.resolve is already mocked in beforeEach
      // PersonaResolver.resolve returns preferredName directly
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: null,
      });
      mockResolveAllMentions.mockResolvedValue({
        processedContent: '[no text content]',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
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
      // PersonaResolver.resolve is already mocked in beforeEach
      // PersonaResolver.resolve returns preferredName directly
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([
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
      mockResolveAllMentions.mockResolvedValue({
        processedContent: 'Voice message',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Voice message');

      // Should complete successfully with debug logging
      expect(result.context.messageContent).toBe('Voice message');
    });

    it('should not include referencedMessages in context when empty', async () => {
      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      // PersonaResolver.resolve is already mocked in beforeEach
      // PersonaResolver.resolve returns preferredName directly
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello');

      expect(result.context.referencedMessages).toBeUndefined();
      expect(result.referencedMessages).toEqual([]);
    });

    it('should resolve user mentions and include mentionedPersonas in context', async () => {
      // Add mentioned users to the mock message
      const mockMentionedUser = {
        id: '123456',
        username: 'mentioneduser',
        globalName: 'Mentioned User',
      } as User;
      (mockMessage.mentions.users as Map<string, User>).set('123456', mockMentionedUser);

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      // PersonaResolver.resolve is already mocked in beforeEach
      // PersonaResolver.resolve returns preferredName directly
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hey <@123456>, how are you?',
      });
      mockResolveAllMentions.mockResolvedValue({
        processedContent: 'Hey @MentionedPersona, how are you?',
        mentionedUsers: [
          {
            discordId: '123456',
            userId: 'mentioned-user-uuid',
            personaId: 'mentioned-persona-uuid',
            personaName: 'MentionedPersona',
          },
        ],
        mentionedChannels: [],
        mentionedRoles: [],
      });

      const result = await builder.buildContext(
        mockMessage,
        mockPersonality,
        'Hey <@123456>, how are you?'
      );

      // Verify mention resolution was called with message object
      expect(mockResolveAllMentions).toHaveBeenCalledWith(
        'Hey <@123456>, how are you?',
        mockMessage,
        'personality-123'
      );

      // Verify processed content
      expect(result.messageContent).toBe('Hey @MentionedPersona, how are you?');
      expect(result.context.messageContent).toBe('Hey @MentionedPersona, how are you?');

      // Verify mentionedPersonas is included in context
      expect(result.context.mentionedPersonas).toEqual([
        {
          personaId: 'mentioned-persona-uuid',
          personaName: 'MentionedPersona',
        },
      ]);
    });

    it('should not include mentionedPersonas when no mentions resolved', async () => {
      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      // PersonaResolver.resolve is already mocked in beforeEach
      // PersonaResolver.resolve returns preferredName directly
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello world',
      });
      // resolveAllMentions returns no mentioned users (default mock behavior)

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello world');

      // Verify mention resolution was called (always called now)
      expect(mockResolveAllMentions).toHaveBeenCalled();

      // Verify mentionedPersonas is undefined when no users were mentioned
      expect(result.context.mentionedPersonas).toBeUndefined();
    });

    it('should apply context epoch filter when user has cleared history (STM)', async () => {
      const contextEpoch = new Date('2025-01-15T12:00:00Z');

      // Set up the epoch in UserPersonaHistoryConfig
      vi.mocked(mockPrisma.userPersonaHistoryConfig.findUnique).mockResolvedValue({
        lastContextReset: contextEpoch,
      } as any);

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getUserTimezone).mockResolvedValue('UTC');
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello after clear',
      });
      mockResolveAllMentions.mockResolvedValue({
        processedContent: 'Hello after clear',
        mentionedUsers: [],
        mentionedChannels: [],
      });

      await builder.buildContext(mockMessage, mockPersonality, 'Hello after clear');

      // Verify the epoch was looked up
      expect(mockPrisma.userPersonaHistoryConfig.findUnique).toHaveBeenCalledWith({
        where: {
          userId_personalityId_personaId: {
            userId: 'user-uuid-123',
            personalityId: 'personality-123',
            personaId: 'persona-123',
          },
        },
        select: {
          lastContextReset: true,
        },
      });

      // Verify history was fetched WITH the context epoch
      expect(mockHistoryService.getChannelHistory).toHaveBeenCalledWith(
        'channel-123',
        100,
        contextEpoch
      );
    });

    it('should not apply epoch filter when user has not cleared history', async () => {
      // No epoch set (default mock returns null)
      vi.mocked(mockPrisma.userPersonaHistoryConfig.findUnique).mockResolvedValue(null);

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getUserTimezone).mockResolvedValue('UTC');
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });
      mockResolveAllMentions.mockResolvedValue({
        processedContent: 'Hello',
        mentionedUsers: [],
        mentionedChannels: [],
      });

      await builder.buildContext(mockMessage, mockPersonality, 'Hello');

      // Verify history was fetched WITHOUT epoch (undefined)
      expect(mockHistoryService.getChannelHistory).toHaveBeenCalledWith(
        'channel-123',
        100,
        undefined
      );
    });

    it('should fetch and merge extended context when enabled', async () => {
      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getUserTimezone).mockResolvedValue('UTC');

      // DB history (when extended context is enabled, getChannelHistory is used)
      const dbHistory = [
        {
          id: 'db-msg-1',
          role: MessageRole.User,
          content: 'Previous from DB',
          createdAt: new Date('2025-01-01T00:00:00Z'),
          personaId: 'persona-123',
          personaName: 'Test Persona',
          discordMessageId: ['discord-1'],
        },
      ];
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue(dbHistory);

      // Extended context messages from Discord (no [Name]: prefix - uses personaName for XML)
      const extendedMessages = [
        {
          id: 'ext-msg-1',
          role: MessageRole.User,
          content: 'Hello from Discord',
          createdAt: new Date('2025-01-01T01:00:00Z'),
          personaId: 'discord:user-alice',
          personaName: 'Alice',
          discordMessageId: ['discord-ext-1'],
        },
      ];
      mockFetchRecentMessages.mockResolvedValue({
        messages: extendedMessages,
        fetchedCount: 10,
        filteredCount: 1,
      });

      // Merged history (what mergeWithHistory returns)
      const mergedHistory = [...extendedMessages, ...dbHistory];
      mockMergeWithHistory.mockReturnValue(mergedHistory);

      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });
      mockResolveAllMentions.mockResolvedValue({
        processedContent: 'Hello',
        mentionedUsers: [],
        mentionedChannels: [],
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello', {
        extendedContext: {
          enabled: true,
          maxMessages: 20,
          maxAge: null,
          maxImages: 0,
          sources: {
            enabled: 'global',
            maxMessages: 'global',
            maxAge: 'global',
            maxImages: 'global',
          },
        },
        botUserId: 'bot-123',
      });

      // Verify channel fetcher was called with transcript retriever
      expect(mockFetchRecentMessages).toHaveBeenCalledWith(mockMessage.channel, {
        limit: 20, // From resolved extendedContext.maxMessages
        maxAge: null, // From resolved extendedContext.maxAge
        before: 'message-123',
        botUserId: 'bot-123',
        personalityName: 'Test Bot',
        personalityId: 'personality-123',
        getTranscript: expect.any(Function), // Transcript retriever for voice messages
      });

      // Verify merge was called
      expect(mockMergeWithHistory).toHaveBeenCalledWith(extendedMessages, dbHistory);

      // Verify conversation history includes merged data
      expect(result.conversationHistory).toHaveLength(2);
    });

    it('should not fetch extended context when disabled', async () => {
      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getUserTimezone).mockResolvedValue('UTC');
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });
      mockResolveAllMentions.mockResolvedValue({
        processedContent: 'Hello',
        mentionedUsers: [],
        mentionedChannels: [],
      });

      await builder.buildContext(mockMessage, mockPersonality, 'Hello', {
        extendedContext: {
          enabled: false,
          maxMessages: 20,
          maxAge: null,
          maxImages: 0,
          sources: {
            enabled: 'global',
            maxMessages: 'global',
            maxAge: 'global',
            maxImages: 'global',
          },
        },
        botUserId: 'bot-123',
      });

      // Should not call channel fetcher when extended context is disabled
      expect(mockFetchRecentMessages).not.toHaveBeenCalled();
      expect(mockMergeWithHistory).not.toHaveBeenCalled();
    });

    it('should not fetch extended context when botUserId is not provided', async () => {
      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getUserTimezone).mockResolvedValue('UTC');
      // When extendedContext.enabled is true, getChannelHistory is used instead of getRecentHistory
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });
      mockResolveAllMentions.mockResolvedValue({
        processedContent: 'Hello',
        mentionedUsers: [],
        mentionedChannels: [],
      });

      await builder.buildContext(mockMessage, mockPersonality, 'Hello', {
        extendedContext: {
          enabled: true,
          maxMessages: 20,
          maxAge: null,
          maxImages: 0,
          sources: {
            enabled: 'global',
            maxMessages: 'global',
            maxAge: 'global',
            maxImages: 'global',
          },
        },
        // botUserId not provided
      });

      // Should not call channel fetcher without botUserId
      expect(mockFetchRecentMessages).not.toHaveBeenCalled();
    });

    it('should collect image attachments when maxImages > 0', async () => {
      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getUserTimezone).mockResolvedValue('UTC');
      // When extendedContext.enabled is true, getChannelHistory is used instead of getRecentHistory
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([]);

      // Extended context with image attachments
      const imageAttachments = [
        {
          url: 'https://cdn.discord.com/attachments/img1.jpg',
          name: 'img1.jpg',
          contentType: 'image/jpeg',
          size: 1000,
        },
        {
          url: 'https://cdn.discord.com/attachments/img2.png',
          name: 'img2.png',
          contentType: 'image/png',
          size: 2000,
        },
        {
          url: 'https://cdn.discord.com/attachments/img3.gif',
          name: 'img3.gif',
          contentType: 'image/gif',
          size: 3000,
        },
      ];

      // Need at least one message for the image collection block to execute
      const extendedMessages = [
        {
          id: 'ext-msg-1',
          role: MessageRole.User,
          content: 'Hello',
          createdAt: new Date('2025-01-01T01:00:00Z'),
          personaId: 'discord:user-alice',
          personaName: 'Alice',
          discordMessageId: ['discord-ext-1'],
        },
      ];

      mockFetchRecentMessages.mockResolvedValue({
        messages: extendedMessages,
        fetchedCount: 10,
        filteredCount: 1,
        imageAttachments,
      });
      mockMergeWithHistory.mockReturnValue(extendedMessages);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });
      mockResolveAllMentions.mockResolvedValue({
        processedContent: 'Hello',
        mentionedUsers: [],
        mentionedChannels: [],
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello', {
        extendedContext: {
          enabled: true,
          maxMessages: 20,
          maxAge: null,
          maxImages: 2, // Only take 2 images
          sources: {
            enabled: 'global',
            maxMessages: 'global',
            maxAge: 'global',
            maxImages: 'global',
          },
        },
        botUserId: 'bot-123',
      });

      // Should include the first 2 images (limited by maxImages)
      // Note: buildContext returns { context, ... } so access via context property
      expect(result.context.extendedContextAttachments).toHaveLength(2);
      expect(result.context.extendedContextAttachments?.[0].url).toBe(
        'https://cdn.discord.com/attachments/img1.jpg'
      );
      expect(result.context.extendedContextAttachments?.[1].url).toBe(
        'https://cdn.discord.com/attachments/img2.png'
      );
    });

    it('should not collect images when maxImages is 0', async () => {
      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getUserTimezone).mockResolvedValue('UTC');
      // When extendedContext.enabled is true, getChannelHistory is used instead of getRecentHistory
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([]);

      // Need messages so the extended context block executes
      const extendedMessages = [
        {
          id: 'ext-msg-1',
          role: MessageRole.User,
          content: 'Hello',
          createdAt: new Date('2025-01-01T01:00:00Z'),
          personaId: 'discord:user-alice',
          personaName: 'Alice',
          discordMessageId: ['discord-ext-1'],
        },
      ];

      mockFetchRecentMessages.mockResolvedValue({
        messages: extendedMessages,
        fetchedCount: 10,
        filteredCount: 1,
        imageAttachments: [
          {
            url: 'https://cdn.discord.com/img.jpg',
            name: 'img.jpg',
            contentType: 'image/jpeg',
            size: 1000,
          },
        ],
      });
      mockMergeWithHistory.mockReturnValue(extendedMessages);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });
      mockResolveAllMentions.mockResolvedValue({
        processedContent: 'Hello',
        mentionedUsers: [],
        mentionedChannels: [],
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello', {
        extendedContext: {
          enabled: true,
          maxMessages: 20,
          maxAge: null,
          maxImages: 0, // No images
          sources: {
            enabled: 'global',
            maxMessages: 'global',
            maxAge: 'global',
            maxImages: 'global',
          },
        },
        botUserId: 'bot-123',
      });

      // Should not include any images when maxImages is 0
      // Note: buildContext returns { context, ... } so access via context property
      expect(result.context.extendedContextAttachments).toBeUndefined();
    });

    it('should resolve discord:XXXX personaIds to actual UUIDs when users are created', async () => {
      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      vi.mocked(mockUserService.getUserTimezone).mockResolvedValue('UTC');
      vi.mocked(mockHistoryService.getChannelHistory).mockResolvedValue([]);

      // Mock batch user creation to return a mapping
      const userMap = new Map([
        ['user-alice', 'alice-uuid-123'],
        ['user-bob', 'bob-uuid-456'],
      ]);
      vi.mocked(mockUserService.getOrCreateUsersInBatch).mockResolvedValue(userMap);

      // Mock PersonaResolver.resolve to return different persona IDs
      // Use mockImplementation instead of mockResolvedValueOnce for deterministic behavior
      // with Promise.allSettled (call order isn't guaranteed with parallel resolution)
      mockPersonaResolver.resolve.mockImplementation((discordId: string) => {
        if (discordId === 'user-alice') {
          return Promise.resolve({
            config: {
              personaId: 'alice-persona-uuid',
              preferredName: 'Alice Display',
              pronouns: null,
            },
            source: 'user-default',
          });
        }
        if (discordId === 'user-bob') {
          return Promise.resolve({
            config: { personaId: 'bob-persona-uuid', preferredName: 'Bob Display', pronouns: null },
            source: 'user-default',
          });
        }
        // Default for current user (discordId = 'user-123')
        return Promise.resolve({
          config: { personaId: 'persona-123', preferredName: 'Test Persona', pronouns: null },
          source: 'user-default',
        });
      });

      // Extended context messages with discord:XXXX format personaIds
      const extendedMessages = [
        {
          id: 'ext-msg-1',
          role: MessageRole.User,
          content: 'Hello from Alice',
          createdAt: new Date('2025-01-01T01:00:00Z'),
          personaId: 'discord:user-alice',
          personaName: 'Alice',
          discordMessageId: ['discord-ext-1'],
        },
        {
          id: 'ext-msg-2',
          role: MessageRole.User,
          content: 'Hello from Bob',
          createdAt: new Date('2025-01-01T01:05:00Z'),
          personaId: 'discord:user-bob',
          personaName: 'Bob',
          discordMessageId: ['discord-ext-2'],
        },
      ];

      // Mock fetch result with extendedContextUsers
      mockFetchRecentMessages.mockResolvedValue({
        messages: extendedMessages,
        fetchedCount: 10,
        filteredCount: 2,
        extendedContextUsers: [
          { discordId: 'user-alice', username: 'alice', isBot: false },
          { discordId: 'user-bob', username: 'bob', isBot: false },
        ],
        participantGuildInfo: {
          'discord:user-alice': { roles: ['Member'], displayColor: '#FF0000' },
          'discord:user-bob': { roles: ['Admin'], displayColor: '#00FF00' },
        },
      });

      mockMergeWithHistory.mockReturnValue(extendedMessages);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });
      mockResolveAllMentions.mockResolvedValue({
        processedContent: 'Hello',
        mentionedUsers: [],
        mentionedChannels: [],
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello', {
        extendedContext: {
          enabled: true,
          maxMessages: 20,
          maxAge: null,
          maxImages: 0,
          sources: {
            enabled: 'global',
            maxMessages: 'global',
            maxAge: 'global',
            maxImages: 'global',
          },
        },
        botUserId: 'bot-123',
      });

      // Verify batch user creation was called
      expect(mockUserService.getOrCreateUsersInBatch).toHaveBeenCalledWith([
        { discordId: 'user-alice', username: 'alice', isBot: false },
        { discordId: 'user-bob', username: 'bob', isBot: false },
      ]);

      // Verify PersonaResolver.resolve was called for each extended context user
      // First call is for the current user, then for alice, then for bob
      expect(mockPersonaResolver.resolve).toHaveBeenCalledWith('user-alice', 'personality-123');
      expect(mockPersonaResolver.resolve).toHaveBeenCalledWith('user-bob', 'personality-123');

      // Verify personaIds were resolved to UUIDs in the messages
      expect(extendedMessages[0].personaId).toBe('alice-persona-uuid');
      expect(extendedMessages[0].personaName).toBe('Alice Display');
      expect(extendedMessages[1].personaId).toBe('bob-persona-uuid');
      expect(extendedMessages[1].personaName).toBe('Bob Display');

      // Verify participantGuildInfo keys were remapped
      expect(result.context.participantGuildInfo).toBeDefined();
      expect(result.context.participantGuildInfo?.['alice-persona-uuid']).toEqual({
        roles: ['Member'],
        displayColor: '#FF0000',
      });
      expect(result.context.participantGuildInfo?.['bob-persona-uuid']).toEqual({
        roles: ['Admin'],
        displayColor: '#00FF00',
      });
      // Old keys should be gone
      expect(result.context.participantGuildInfo?.['discord:user-alice']).toBeUndefined();
      expect(result.context.participantGuildInfo?.['discord:user-bob']).toBeUndefined();
    });
  });
});
