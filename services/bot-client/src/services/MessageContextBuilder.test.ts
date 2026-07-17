/**
 * Tests for MessageContextBuilder
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageContextBuilder } from './MessageContextBuilder.js';
import { redisService } from '../redis.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { Collection } from 'discord.js';
import type { Message, Attachment, Guild, GuildMember, TextChannel, User } from 'discord.js';
import { MessageRole } from '@tzurot/common-types/constants/message';
import type { ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';

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
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
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

// Mock redis since TranscriptRetriever imports it and the extended-context
// fetch wires redisService.getWebhookPersonality through as getOurPersonalityId.
vi.mock('../redis.js', () => ({
  redisService: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    expire: vi.fn(),
    setWithExpiry: vi.fn(),
    getWebhookPersonality: vi.fn(),
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

// The author's routing facts (internal id, persona, timezone, epoch) are now
// resolved by `resolveUserContext` (which calls the gateway `routing-context`
// endpoint — tested in UserContextResolver.test.ts). Mock it here so these
// tests exercise buildContext's ORCHESTRATION given a resolved author bundle,
// not the resolution mechanism. Override per-test for epoch / persona variants.
const mockResolveUserContext = vi.fn();
vi.mock('./contextBuilder/index.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./contextBuilder/index.js')>();
  return {
    ...actual,
    resolveUserContext: (...args: unknown[]) => mockResolveUserContext(...args),
  };
});

// Mock for DiscordChannelFetcher
const mockFetchRecentMessages = vi.fn();
const mockMergeWithHistory = vi.fn();

vi.mock('./DiscordChannelFetcher.js', () => ({
  DiscordChannelFetcher: class {
    fetchRecentMessages = mockFetchRecentMessages;
    mergeWithHistory = mockMergeWithHistory;
  },
}));

// Only the known-channel-environments builder remains in CrossChannelHistoryFetcher
// (the cross-channel fetch is the worker's now).
vi.mock('./CrossChannelHistoryFetcher.js', () => ({
  buildKnownChannelEnvironments: vi.fn(() => ({
    '999888777666555444': {
      type: 'guild',
      guild: { id: 'guild-1', name: 'Cached Guild' },
      channel: { id: '999888777666555444', name: 'cached-channel', type: 'GUILD_TEXT' },
    },
  })),
}));

// Import after mocks
import { extractDiscordEnvironment } from '../utils/discordContext.js';
import { extractAttachments } from '../utils/attachmentExtractor.js';
import { MessageReferenceExtractor as _MessageReferenceExtractor } from '../handlers/MessageReferenceExtractor.js';

describe('MessageContextBuilder', () => {
  let builder: MessageContextBuilder;
  let mockPrisma: PrismaClient;
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

    // Default author bundle (resolveUserContext is mocked above). Mirrors the
    // values the old userService/personaResolver/epoch mocks produced for the
    // author, so the envelope-shape assertions stay stable.
    mockResolveUserContext.mockResolvedValue({
      internalUserId: 'internal-user-uuid',
      discordUserId: 'user-123',
      personaId: 'persona-123',
      personaName: 'Test Persona',
      userTimezone: undefined,
      contextEpoch: undefined,
      history: [],
    });

    // Create builder instance — serviceClient is a stub since resolveUserContext
    // (the only consumer) is mocked.
    builder = new MessageContextBuilder({} as any);

    // Default mock for PersonaResolver.resolve
    mockPersonaResolver.resolve.mockResolvedValue({
      config: {
        personaId: 'persona-123',
        preferredName: 'Test Persona',
        pronouns: null,
        content: '',
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
      provider: 'openrouter',
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
    mockResolveAllMentions.mockReturnValue({
      processedContent: 'Hello world',
      mentionedUsers: [],
      mentionedChannels: [],
      mentionedRoles: [],
    });
  });

  describe('buildContext', () => {
    it('attaches rawAssemblyInputs — the worker re-derives the context from it', async () => {
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'REWRITTEN content',
      });
      // The mention resolver is the LAST rewriter — its output is the
      // assembled messageContent.
      mockResolveAllMentions.mockReturnValue({
        processedContent: 'REWRITTEN content',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, '<@123> raw content');

      const raw = result.context.rawAssemblyInputs;
      expect(raw).toBeDefined();
      // The raw side carries Discord GROUND TRUTH (message.content verbatim) —
      // not the transcript-bearing content param; messageContent carries the
      // rewritten one.
      expect(raw?.rawMessageContent).toBe('Hello world');
      expect(result.context.messageContent).toBe('REWRITTEN content');
      // Empty mentions collection → field omitted, not [].
      expect(raw?.rawMentionedUsers).toBeUndefined();
      // Channel-environment map comes from the Discord.js cache walk.
      expect(raw?.knownChannelEnvironments?.['999888777666555444']).toMatchObject({
        type: 'guild',
      });
    });

    it("ships a thin kind:'envelope' payload (omits all 7 re-derivable fields)", async () => {
      // Populate the guild/attachment surfaces in the fetch result so the
      // omission assertions below prove the ENVELOPE drops them, not that the
      // mock simply left them empty. guildMemberInfo for the trigger user comes
      // from the message's member mock; participantGuildInfo + images come from
      // the fetch.
      mockFetchRecentMessages.mockResolvedValue({
        messages: [],
        fetchedCount: 0,
        keptCount: 0,
        participantGuildInfo: { 'discord:other': { roles: ['Member'] } },
        imageAttachments: [{ url: 'https://cdn/x.png', contentType: 'image/png', id: 'x' }],
      });
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'REWRITTEN content',
      });
      mockResolveAllMentions.mockReturnValue({
        processedContent: 'REWRITTEN content',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
      });

      // extendedContext + botUserId are required for the fetch above to run
      // (it early-returns otherwise) — without them participantGuildInfo /
      // imageAttachments would be unpopulated and the assertions below would
      // be theater. maxImages > 0 so the image list isn't capped to nothing.
      const result = await builder.buildContext(mockMessage, mockPersonality, 'raw content', {
        extendedContext: {
          maxMessages: 20,
          maxAge: null,
          maxImages: 10,
          sources: {
            maxMessages: 'personality',
            maxAge: 'personality',
            maxImages: 'personality',
          },
        },
        botUserId: 'bot-123',
      });

      expect(result.context.kind).toBe('envelope');
      // The three core re-derivable fields are omitted; the worker assembles them.
      expect(result.context.referencedMessages).toBeUndefined();
      expect(result.context.mentionedPersonas).toBeUndefined();
      expect(result.context.referencedChannels).toBeUndefined();
      // The three guild/attachment surfaces are omitted too — populated in the
      // fetch mock above, so undefined here proves the envelope omits them
      // rather than the mock never setting them.
      expect(result.context.participantGuildInfo).toBeUndefined();
      expect(result.context.activePersonaGuildInfo).toBeUndefined();
      expect(result.context.extendedContextAttachments).toBeUndefined();
      // The envelope itself still ships (the worker's only input now), with the
      // raw forms the worker re-derives from.
      expect(result.context.rawAssemblyInputs?.rawParticipantGuildInfo).toBeDefined();
    });

    it('should build complete context with user lookup and history', async () => {
      // The author bundle is resolved by the (mocked) routing-context call.
      mockResolveUserContext.mockResolvedValue({
        internalUserId: 'user-uuid-123',
        discordUserId: 'user-123',
        personaId: 'persona-123',
        personaName: 'Test Persona',
        userTimezone: undefined,
        contextEpoch: undefined,
        history: [],
      });
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello world',
      });

      // Execute
      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello world');

      // Author resolution is delegated to resolveUserContext (the routing-context
      // call) with the effective user + personality + resolved display name.
      expect(mockResolveUserContext).toHaveBeenCalledWith(
        { id: 'user-123', username: 'testuser', bot: false },
        mockPersonality,
        'Test Display Name',
        expect.anything()
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

      // Author bundle with a null persona name (no preferred name resolved).
      mockResolveUserContext.mockResolvedValue({
        internalUserId: 'user-uuid-123',
        discordUserId: 'user-123',
        personaId: 'persona-123',
        personaName: null,
        userTimezone: undefined,
        contextEpoch: undefined,
        history: [],
      });
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello');

      // With no member + no globalName, the display name falls back to username
      // and is forwarded to the routing-context resolution.
      expect(mockResolveUserContext).toHaveBeenCalledWith(
        { id: 'user-123', username: 'testuser', bot: false },
        mockPersonality,
        'testuser',
        expect.anything()
      );
      expect(result.context.activePersonaName).toBeUndefined();
    });

    it('should handle empty conversation history', async () => {
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'First message',
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'First message');

      // Non-voice message should be false
      expect(result.context.isVoiceMessage).toBe(false);
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

      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: mockReferences,
        updatedContent: 'Check [Reference 1]',
        rawReferences: mockReferences,
      });
      mockResolveAllMentions.mockReturnValue({
        processedContent: 'Check [Reference 1]',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Check this message');

      // The extraction output reaches the worker via the raw envelope's
      // rawReferencedMessages (the former ContextBuildResult.referencedMessages
      // return field was dead — never read — and has been removed).
      const rawRefs = result.context.rawAssemblyInputs?.rawReferencedMessages;
      expect(rawRefs).toHaveLength(1);
      expect(rawRefs?.[0]).toMatchObject({
        referenceNumber: 1,
        content: 'Referenced content',
      });
      expect(result.messageContent).toBe('Check [Reference 1]');
    });

    it('does not run the extended-context fetch by default (no Postgres history service wired for dedup)', async () => {
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });

      await builder.buildContext(mockMessage, mockPersonality, 'Hello');

      // bot-client no longer reads channel history from Postgres for dedup. The
      // shipped rawReferences are dedup-invariant (proven in
      // MessageReferenceExtractor.test.ts), so the worker re-derives reference
      // dedup from the raw envelope against its own assembled history. The fetch
      // path never receives a Postgres-backed history service.
      expect(mockFetchRecentMessages).not.toHaveBeenCalled();
    });

    it('should extract attachments from message', async () => {
      const mockAttachments = [
        {
          url: 'https://example.com/image.png',
          name: 'image.png',
          contentType: 'image/png',
        },
      ];

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
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: null,
      });
      mockResolveAllMentions.mockReturnValue({
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

      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Voice message',
      });
      mockResolveAllMentions.mockReturnValue({
        processedContent: 'Voice message',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Voice message');

      // Should complete successfully with debug logging
      expect(result.context.messageContent).toBe('Voice message');
      // Should detect voice message from audio attachment with duration
      expect(result.context.isVoiceMessage).toBe(true);
    });

    it('should not include referencedMessages in context when empty', async () => {
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello');

      expect(result.context.referencedMessages).toBeUndefined();
      // No references extracted → the raw envelope carries none either.
      expect(result.context.rawAssemblyInputs?.rawReferencedMessages).toBeUndefined();
    });

    it('does NOT resolve user mentions bot-side (worker re-derives) — channel/role only', async () => {
      // A real user mention stays RAW in the shipped content; the worker rewrites
      // it to a persona name from rawMentionedUsers. resolveAllMentions runs only
      // for channel/role (guild-cache), with the (content, guild) signature.
      const mockMentionedUser = {
        id: '123456',
        username: 'mentioneduser',
        globalName: 'Mentioned User',
      } as User;
      (mockMessage.mentions.users as Map<string, User>).set('123456', mockMentionedUser);

      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hey <@123456>, how are you?',
      });
      // Channel/role rewriting leaves the user mention untouched.
      mockResolveAllMentions.mockReturnValue({
        processedContent: 'Hey <@123456>, how are you?',
        mentionedChannels: [],
        mentionedRoles: [],
      });

      const result = await builder.buildContext(
        mockMessage,
        mockPersonality,
        'Hey <@123456>, how are you?'
      );

      // Called with (content, guild) — no personalityId, no user resolution.
      expect(mockResolveAllMentions).toHaveBeenCalledWith(
        'Hey <@123456>, how are you?',
        mockMessage.guild
      );
      // The user mention ships RAW (the worker rewrites it).
      expect(result.context.messageContent).toBe('Hey <@123456>, how are you?');

      // The enriched field never ships — the worker re-derives it.
      expect(result.context.mentionedPersonas).toBeUndefined();
    });

    it('should apply context epoch filter when user has cleared history (STM)', async () => {
      const contextEpoch = new Date('2025-01-15T12:00:00Z');

      // The epoch is now resolved server-side and returned in the author bundle.
      mockResolveUserContext.mockResolvedValue({
        internalUserId: 'user-uuid-123',
        discordUserId: 'user-123',
        personaId: 'persona-123',
        personaName: 'Test Persona',
        userTimezone: 'UTC',
        contextEpoch,
        history: [],
      });
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello after clear',
      });
      mockResolveAllMentions.mockReturnValue({
        processedContent: 'Hello after clear',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
      });

      mockFetchRecentMessages.mockResolvedValue({
        messages: [],
        fetchedCount: 0,
        keptCount: 0,
      });

      // Extended context enabled so the Discord fetch receives the epoch —
      // bot-client no longer applies it to a Postgres read (the worker does).
      await builder.buildContext(mockMessage, mockPersonality, 'Hello after clear', {
        extendedContext: {
          maxMessages: 50,
          maxAge: null,
          maxImages: 0,
          sources: { maxMessages: 'personality', maxAge: 'personality', maxImages: 'personality' },
        },
        botUserId: 'bot-123',
      });

      // The context epoch flows to the Discord fetch (it filters which channel
      // messages ship in the raw snapshot).
      expect(mockFetchRecentMessages).toHaveBeenCalledWith(
        mockMessage.channel,
        expect.objectContaining({ contextEpoch })
      );
    });

    it('should NOT apply the per-user epoch in weigh-in mode even when one is set', async () => {
      const contextEpoch = new Date('2025-01-15T12:00:00Z');

      // The invoking user HAS a recent STM reset (returned in the author bundle)...
      mockResolveUserContext.mockResolvedValue({
        internalUserId: 'user-uuid-123',
        discordUserId: 'user-123',
        personaId: 'persona-123',
        personaName: 'Test Persona',
        userTimezone: 'UTC',
        contextEpoch,
        history: [],
      });
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Weigh in',
      });
      mockResolveAllMentions.mockReturnValue({
        processedContent: 'Weigh in',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
      });

      mockFetchRecentMessages.mockResolvedValue({
        messages: [],
        fetchedCount: 0,
        keptCount: 0,
      });

      await builder.buildContext(mockMessage, mockPersonality, 'Weigh in', {
        isWeighInMode: true,
        extendedContext: {
          maxMessages: 50,
          maxAge: null,
          maxImages: 0,
          sources: { maxMessages: 'personality', maxAge: 'personality', maxImages: 'personality' },
        },
        botUserId: 'bot-123',
      });

      // ...but weigh-in is a channel-scoped anonymous summon, so that private
      // reset must not bound the shared channel. The epoch is dropped (undefined)
      // before it reaches the Discord fetch, not passed through.
      expect(mockFetchRecentMessages).toHaveBeenCalledWith(
        mockMessage.channel,
        expect.objectContaining({ contextEpoch: undefined })
      );
    });

    it('should not apply epoch filter when user has not cleared history', async () => {
      // No epoch set (default mock returns null)
      vi.mocked(mockPrisma.userPersonaHistoryConfig.findUnique).mockResolvedValue(null);

      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });
      mockResolveAllMentions.mockReturnValue({
        processedContent: 'Hello',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
      });

      mockFetchRecentMessages.mockResolvedValue({
        messages: [],
        fetchedCount: 0,
        keptCount: 0,
      });

      await builder.buildContext(mockMessage, mockPersonality, 'Hello', {
        extendedContext: {
          maxMessages: 50,
          maxAge: null,
          maxImages: 0,
          sources: { maxMessages: 'personality', maxAge: 'personality', maxImages: 'personality' },
        },
        botUserId: 'bot-123',
      });

      // No STM clear → no epoch reaches the Discord fetch.
      expect(mockFetchRecentMessages).toHaveBeenCalledWith(
        mockMessage.channel,
        expect.objectContaining({ contextEpoch: undefined })
      );
    });

    it('should fetch and merge extended context when enabled', async () => {
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
        keptCount: 1,
      });

      // Merged history (what mergeWithHistory returns) — base is empty since
      // bot-client no longer reads DB history.
      mockMergeWithHistory.mockReturnValue(extendedMessages);

      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });
      mockResolveAllMentions.mockReturnValue({
        processedContent: 'Hello',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
      });

      await builder.buildContext(mockMessage, mockPersonality, 'Hello', {
        extendedContext: {
          maxMessages: 20,
          maxAge: null,
          maxImages: 0,
          sources: {
            maxMessages: 'personality',
            maxAge: 'personality',
            maxImages: 'personality',
          },
        },
        botUserId: 'bot-123',
      });

      // Verify channel fetcher was called with transcript retriever.
      // `botSuffix` is derived from `message.client?.user?.tag`; tests that
      // don't mock the client get `''` (back-compat fallback).
      expect(mockFetchRecentMessages).toHaveBeenCalledWith(
        mockMessage.channel,
        expect.objectContaining({
          limit: 20, // From resolved extendedContext.maxMessages
          maxAge: null, // From resolved extendedContext.maxAge
          before: 'message-123',
          botUserId: 'bot-123',
          personalityName: 'Test Bot',
          personalityId: 'personality-123',
          getTranscript: expect.any(Function), // Transcript retriever for voice messages
        })
      );

      // Verify merge was called with an EMPTY base — bot-client no longer reads DB
      // history (the worker re-derives history from the envelope). The merge result
      // feeds only the local reference dedup, which is now vestigial.
      expect(mockMergeWithHistory).toHaveBeenCalledWith(extendedMessages, []);
    });

    it('weigh-in omits `before` so the latest (anchor) message is READ, not excluded', async () => {
      // Chat mode anchors on the user's NEW message and excludes it via
      // `before: message.id`. Weigh-in anchors on the latest EXISTING message,
      // which is part of the room and must be included → no `before` cursor.
      mockFetchRecentMessages.mockResolvedValue({
        messages: [],
        fetchedCount: 0,
        keptCount: 0,
      });
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'hi',
      });
      mockResolveAllMentions.mockReturnValue({
        processedContent: 'hi',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
      });

      await builder.buildContext(mockMessage, mockPersonality, 'hi', {
        extendedContext: {
          maxMessages: 20,
          maxAge: null,
          maxImages: 0,
          sources: { maxMessages: 'personality', maxAge: 'personality', maxImages: 'personality' },
        },
        botUserId: 'bot-123',
        isWeighInMode: true,
      });

      expect(mockFetchRecentMessages).toHaveBeenCalledWith(
        mockMessage.channel,
        expect.objectContaining({ before: undefined })
      );
    });

    it('builds a usable context from a field-only anchor (empty-channel weigh-in synthetic)', async () => {
      // Locks the `createSyntheticWeighInAnchor` (chat.ts) field-only contract:
      // buildContext must work given an anchor that exposes only FIELDS (no
      // methods), mirroring the empty-channel synthetic. If buildContext ever
      // calls a method on the anchor, this fails here instead of crashing at
      // runtime for an empty-channel weigh-in.
      mockFetchRecentMessages.mockResolvedValue({
        messages: [],
        fetchedCount: 0,
        keptCount: 0,
      });
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: '',
      });
      mockResolveAllMentions.mockReturnValue({
        processedContent: '',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
      });

      // Same shape createSyntheticWeighInAnchor produces: field-only, no methods.
      const syntheticAnchor = {
        id: 'synthetic-weigh-in-anchor',
        channel: mockMessage.channel,
        client: mockMessage.client,
        guild: mockMessage.guild,
        author: mockMessage.author,
        member: null,
        content: '',
        attachments: new Collection(),
        embeds: [],
        messageSnapshots: new Collection(),
        reference: null,
        mentions: { users: new Collection() },
      } as unknown as Message;

      const result = await builder.buildContext(syntheticAnchor, mockPersonality, 'read the room', {
        extendedContext: {
          maxMessages: 20,
          maxAge: null,
          maxImages: 0,
          sources: { maxMessages: 'personality', maxAge: 'personality', maxImages: 'personality' },
        },
        botUserId: 'bot-123',
        isWeighInMode: true,
        overrideUser: mockMessage.author,
      });

      // Higher-confidence than a bare toBeDefined: the field-only anchor produced a
      // usable context with the anchor's channel id propagated through.
      expect(result.context.channelId).toBe('channel-123');
      expect(result.messageContent).toBeDefined();
    });

    it('caches botSuffix on first call and ignores subsequent client.user.tag changes', async () => {
      // The bot's Discord tag doesn't change at runtime, so MessageContextBuilder
      // lazily derives the canonical suffix once and reuses it. This test pins
      // the cache contract: a second call seeing a different `client.user.tag`
      // must still get the value from the first call. If a future refactor
      // re-derives per-call, this test fails — alerting that the cache
      // invariant has drifted.
      mockFetchRecentMessages.mockResolvedValue({
        messages: [],
        fetchedCount: 0,
        keptCount: 0,
      });
      mockMergeWithHistory.mockReturnValue([]);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });
      mockResolveAllMentions.mockReturnValue({
        processedContent: 'Hello',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
      });

      const extendedContext = {
        maxMessages: 20,
        maxAge: null,
        maxImages: 0,
        sources: {
          maxMessages: 'personality' as const,
          maxAge: 'personality' as const,
          maxImages: 'personality' as const,
        },
      };

      // First call: client.user.tag = 'BotA'
      const messageA = {
        ...mockMessage,
        client: { user: { tag: 'BotA' } },
      } as unknown as Message;
      await builder.buildContext(messageA, mockPersonality, 'Hello', {
        extendedContext,
        botUserId: 'bot-123',
      });

      expect(mockFetchRecentMessages).toHaveBeenLastCalledWith(
        messageA.channel,
        expect.objectContaining({ botSuffix: ' · BotA' })
      );

      // Second call: client.user.tag = 'DifferentBot' — cache should win.
      const messageB = {
        ...mockMessage,
        client: { user: { tag: 'DifferentBot' } },
      } as unknown as Message;
      await builder.buildContext(messageB, mockPersonality, 'Hello again', {
        extendedContext,
        botUserId: 'bot-123',
      });

      expect(mockFetchRecentMessages).toHaveBeenLastCalledWith(
        messageB.channel,
        // Still ' · BotA' — first-call value cached, not re-derived.
        expect.objectContaining({ botSuffix: ' · BotA' })
      );
    });

    it('should not fetch extended context when botUserId is not provided', async () => {
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });
      mockResolveAllMentions.mockReturnValue({
        processedContent: 'Hello',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
      });

      await builder.buildContext(mockMessage, mockPersonality, 'Hello', {
        extendedContext: {
          maxMessages: 20,
          maxAge: null,
          maxImages: 0,
          sources: {
            maxMessages: 'personality',
            maxAge: 'personality',
            maxImages: 'personality',
          },
        },
        // botUserId not provided
      });

      // Should not call channel fetcher without botUserId
      expect(mockFetchRecentMessages).not.toHaveBeenCalled();
    });

    it('ships extended-context images RAW + uncapped via rawAssemblyInputs (worker applies maxImages)', async () => {
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
        keptCount: 1,
        imageAttachments,
      });
      mockMergeWithHistory.mockReturnValue(extendedMessages);
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'Hello',
      });
      mockResolveAllMentions.mockReturnValue({
        processedContent: 'Hello',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello', {
        extendedContext: {
          maxMessages: 20,
          maxAge: null,
          maxImages: 2, // Only take 2 images
          sources: {
            maxMessages: 'personality',
            maxAge: 'personality',
            maxImages: 'personality',
          },
        },
        botUserId: 'bot-123',
      });

      // The thin envelope ships extended-context images RAW (uncapped) via
      // rawAssemblyInputs — the worker applies maxImages. The legacy capped
      // context.extendedContextAttachments no longer ships.
      const rawImages = result.context.rawAssemblyInputs?.rawExtendedContextImageAttachments;
      expect(rawImages).toHaveLength(3);
      expect(rawImages?.map(a => a.url)).toEqual([
        'https://cdn.discord.com/attachments/img1.jpg',
        'https://cdn.discord.com/attachments/img2.png',
        'https://cdn.discord.com/attachments/img3.gif',
      ]);
    });

    it('does not ship the legacy capped extendedContextAttachments field', async () => {
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
        keptCount: 1,
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
      mockResolveAllMentions.mockReturnValue({
        processedContent: 'Hello',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello', {
        extendedContext: {
          maxMessages: 20,
          maxAge: null,
          maxImages: 0, // No images
          sources: {
            maxMessages: 'personality',
            maxAge: 'personality',
            maxImages: 'personality',
          },
        },
        botUserId: 'bot-123',
      });

      // Should not include any images when maxImages is 0
      // Note: buildContext returns { context, ... } so access via context property
      expect(result.context.extendedContextAttachments).toBeUndefined();
    });

    it('ships extended-context participants RAW (discord: keys) for the worker to re-resolve', async () => {
      // The participant-batch upsert + persona-id remap moved worker-side: the
      // bot ships the raw `discord:`-keyed snapshot and the worker re-runs the
      // batch + re-keys participantGuildInfo from the raw snapshot; bot-client
      // neither provisions the participants nor remaps ids here (and ships no
      // resolved participantGuildInfo).

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

      mockFetchRecentMessages.mockResolvedValue({
        messages: extendedMessages,
        fetchedCount: 10,
        keptCount: 2,
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
      mockResolveAllMentions.mockReturnValue({
        processedContent: 'Hello',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
      });

      const result = await builder.buildContext(mockMessage, mockPersonality, 'Hello', {
        extendedContext: {
          maxMessages: 20,
          maxAge: null,
          maxImages: 0,
          sources: {
            maxMessages: 'personality',
            maxAge: 'personality',
            maxImages: 'personality',
          },
        },
        botUserId: 'bot-123',
      });

      // The messages keep their raw discord: placeholders — no bot-side remap.
      expect(extendedMessages[0].personaId).toBe('discord:user-alice');
      expect(extendedMessages[1].personaId).toBe('discord:user-bob');

      // The thin envelope ships participantGuildInfo RAW (pre-resolution
      // `discord:` keys) via rawAssemblyInputs — the worker re-resolves them.
      const rawGuild = result.context.rawAssemblyInputs?.rawParticipantGuildInfo;
      expect(rawGuild?.['discord:user-alice']).toEqual({
        roles: ['Member'],
        displayColor: '#FF0000',
      });
      expect(rawGuild?.['discord:user-bob']).toEqual({
        roles: ['Admin'],
        displayColor: '#00FF00',
      });
    });

    it('wires the our-webhook registry into the fetch via getOurPersonalityId', async () => {
      mockFetchRecentMessages.mockResolvedValue({
        messages: [],
        fetchedCount: 0,
        keptCount: 0,
      });
      mockExtractReferencesWithReplacement.mockResolvedValue({
        references: [],
        updatedContent: 'content',
      });
      mockResolveAllMentions.mockReturnValue({
        processedContent: 'content',
        mentionedUsers: [],
        mentionedChannels: [],
        mentionedRoles: [],
      });
      vi.mocked(redisService.getWebhookPersonality).mockResolvedValue('personality-uuid');

      // extendedContext + botUserId are required for the fetch to run at all.
      await builder.buildContext(mockMessage, mockPersonality, 'content', {
        extendedContext: {
          maxMessages: 20,
          maxAge: null,
          maxImages: 0,
          sources: { maxMessages: 'personality', maxAge: 'personality', maxImages: 'personality' },
        },
        botUserId: 'bot-123',
      });

      // The fetch received a getOurPersonalityId callback that delegates to the
      // registry — invoking it proves the registry is actually plumbed in (the
      // crux of the Bug A/B classification fix), not just constructed.
      const fetchOptions = mockFetchRecentMessages.mock.calls[0]?.[1] as {
        getOurPersonalityId?: (id: string) => Promise<string | null>;
      };
      expect(fetchOptions.getOurPersonalityId).toBeTypeOf('function');
      await expect(fetchOptions.getOurPersonalityId!('msg-id-1')).resolves.toBe('personality-uuid');
      expect(redisService.getWebhookPersonality).toHaveBeenCalledWith('msg-id-1');
    });
  });
});
