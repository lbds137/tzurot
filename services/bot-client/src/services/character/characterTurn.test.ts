/**
 * Tests for Character Chat Command Handler (push-delivery model)
 *
 * Behaviors:
 * - Resolves personality / fails on unknown character
 * - Validates channel; accepts GuildText, threads, AND DM (push delivery
 *   replaces the old webhook-only restriction)
 * - Sends user message in chat mode + persists via fields-API
 * - Submits gateway job + registers slash JobTracker context
 * - Weigh-in mode: skips user-message send, anchors on latest channel msg,
 *   sets context flags, requires non-empty conversation history
 * - Random-pick mode: finalizeDeferredReply replaces the deferred indicator
 * - Errors fall through to handleChatError
 *
 * Result delivery is tested in MessageHandler.handleSlashJobResult — chat.ts
 * no longer awaits the job.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleChat, handleRandom, handleChimeIn, WEIGH_IN_MESSAGE } from './characterTurn.js';
import { runSlashChatGates } from './slashChatGates.js';
import { resolveChatLlmConfig } from './chatConfigResolution.js';
import type { GuildMember } from 'discord.js';
import { ChannelType } from 'discord.js';
import { InfraError } from '@tzurot/clients';
import type { PersonalitySummary } from '@tzurot/common-types/schemas/api/personality';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const mockGatewayClient = {
  generate: vi.fn(),
};

const mockJobTracker = {
  trackJob: vi.fn(),
};

const mockPersonalityService = {
  loadPersonality: vi.fn(),
  loadPersonalityStrict: vi.fn(),
};

const mockMessageContextBuilder = {
  buildContext: vi.fn(),
};

const mockConversationPersistence = {
  saveUserMessageFromFields: vi.fn().mockResolvedValue(undefined),
};

const mockResolveUserContext = vi.fn();

vi.mock('../serviceRegistry.js', () => ({
  getPersonalityLoader: () => mockPersonalityService,
  getMessageContextBuilder: () => mockMessageContextBuilder,
  getConversationPersistence: () => mockConversationPersistence,
  getJobTracker: () => mockJobTracker,
}));

// chat.ts resolves the invoker's persona (id + display name) through the
// routing-context helper — bot-client never touches Prisma. Mocking the helper
// directly means the getServiceClient() stub it's handed is never exercised.
vi.mock('../contextBuilder/UserContextResolver.js', () => ({
  resolveUserContext: (...args: unknown[]) => mockResolveUserContext(...args),
}));

/** Build a routing-context result; override `personaName`/`personaId` per case. */
const buildUserContext = (overrides: Record<string, unknown> = {}) => ({
  internalUserId: 'internal-user-1',
  discordUserId: 'user-123',
  personaId: 'persona-123',
  personaName: null,
  userTimezone: undefined,
  contextEpoch: undefined,
  history: [],
  ...overrides,
});

// `generate` moved off GatewayClient to the gatewayServiceCalls module; route
// it to the same holder so the existing assertions keep working unchanged.
vi.mock('../../utils/gatewayServiceCalls.js', () => ({
  generate: (...args: unknown[]) => mockGatewayClient.generate(...args),
}));

const mockGetCachedPersonalities = vi.fn();
vi.mock('../../utils/autocomplete/autocompleteCache.js', () => ({
  getCachedPersonalities: (...args: unknown[]) => mockGetCachedPersonalities(...args),
}));

// Mock clientsFor — the cache + persona resolution mocks return data
// directly, so a structurally empty userClient stub suffices. getServiceClient
// is what chat.ts hands to the (mocked) resolveUserContext, so a bare stub is
// enough — the helper ignores it.
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: {} })),
  clientsForUser: vi.fn(() => ({ userClient: {} })),
  getServiceClient: vi.fn(() => ({})),
}));

// The denylist + NSFW gate and the cascade config-resolution each have their
// own colocated tests; here we stub the seams so the happy-path flow proceeds.
vi.mock('./slashChatGates.js', () => ({
  runSlashChatGates: vi.fn().mockResolvedValue(false),
}));
vi.mock('./chatConfigResolution.js', () => ({
  resolveChatLlmConfig: vi.fn().mockResolvedValue({ config: { model: 'm' }, source: 'hardcoded' }),
  buildExtendedContextSettings: vi.fn().mockReturnValue({
    maxMessages: 50,
    maxAge: null,
    maxImages: 10,
    sources: { maxMessages: 'hardcoded', maxAge: 'hardcoded', maxImages: 'hardcoded' },
  }),
}));

vi.mock('../../redis.js', () => ({
  redisService: { storeWebhookMessage: vi.fn() },
}));

// One shared logger object rather than a fresh one per createLogger() call: the
// module under test binds its logger at import time, so a per-call object would be
// unreachable from here and the warn-on-failed-persist path unobservable.
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

describe('Character Turn Engine (push delivery)', () => {
  // A distinctive createdAt so tests can assert the echo's REAL Discord time (not a
  // pre-send new Date()) anchors both the user row and the assistant's userMessageTime.
  const ECHO_CREATED_AT = new Date('2026-07-01T23:10:54.101Z');
  // Distinctive tokens at the head, middle, and tail of the chunking fixture: each must
  // survive into exactly one persisted slice, which is what proves nothing was dropped
  // at a chunk boundary and nothing was written twice.
  const SENTINEL_START = 'ZQ-ECHO-HEAD-TOKEN';
  const SENTINEL_MIDDLE = 'ZQ-ECHO-MIDDLE-TOKEN';
  const SENTINEL_END = 'ZQ-ECHO-TAIL-TOKEN';
  const createMockMessage = (id: string = 'user-msg-123') => ({
    id,
    client: { user: { id: 'bot-user-123' } },
    channel: { id: 'channel-123' },
    author: { id: 'user-123' },
    createdAt: ECHO_CREATED_AT,
  });

  const createMockCollection = (entries: Array<[string, ReturnType<typeof createMockMessage>]>) => {
    const map = new Map(entries);
    return {
      ...map,
      first: () => (entries.length > 0 ? entries[0][1] : undefined),
      size: entries.length,
    };
  };

  const createMockChannel = (type: ChannelType = ChannelType.GuildText) => {
    // Every send resolves to a DISTINCT message (own id, strictly later createdAt),
    // the way Discord really answers: a single shared resolved value would make a
    // chunked echo's per-chunk id/timestamp anchoring unobservable.
    let sendCount = 0;
    return {
      type,
      id: 'channel-123',
      name: 'test-channel',
      // Real guild channels carry a `guild` (the synthetic anchor reads
      // channel.guild.id for its guildId, used by denylist scoping).
      guild: { id: 'guild-123', name: 'Test Guild' },
      // Real Discord channels always carry a back-reference to the client; the
      // empty-channel synthetic anchor reads `channel.client.user` via it.
      client: { user: { id: 'bot-user-123' } },
      send: vi.fn().mockImplementation(() => {
        const nth = sendCount++;
        return Promise.resolve({
          ...createMockMessage(nth === 0 ? 'user-msg-123' : `user-msg-123-${nth + 1}`),
          createdAt: new Date(ECHO_CREATED_AT.getTime() + nth * 1000),
        });
      }),
      sendTyping: vi.fn().mockResolvedValue(undefined),
      messages: {
        fetch: vi
          .fn()
          .mockResolvedValue(
            createMockCollection([['latest-msg', createMockMessage('latest-msg')]])
          ),
      },
    };
  };

  const createMockGuild = () => ({ id: 'guild-123', name: 'Test Guild' });

  const createMockContext = (
    characterSlug: string | null,
    message: string | null,
    channel = createMockChannel(),
    guild: { id: string; name: string } | null = createMockGuild(),
    /** The `/random tag:` option value, or null when the user gave none. */
    tag: string | null = null
  ): DeferredCommandContext => {
    const mockMember = { displayName: 'TestUser' } as GuildMember;
    const mockUser = { id: 'user-123', displayName: 'TestUser' };

    const mockInteraction = {
      client: { user: { id: 'bot-user-123' } },
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'character') return characterSlug;
          if (name === 'message') return message;
          if (name === 'tag') return tag;
          return null;
        }),
        getBoolean: vi.fn(() => null),
      },
      replied: false,
      deferred: true,
    };

    return {
      interaction: mockInteraction,
      user: mockUser,
      member: guild ? mockMember : null,
      guild,
      guildId: guild?.id ?? null,
      channel,
      isEphemeral: false,
      editReply: vi.fn().mockResolvedValue(undefined),
      deleteReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as DeferredCommandContext;
  };

  /**
   * An accessible-list row, typed so a PersonalitySummary shape change breaks
   * this fixture at compile time rather than silently producing a payload the
   * tag filter can't read.
   */
  const makeSummary = (slug: string, opts: { tags?: string[] } = {}) =>
    ({
      id: `id-${slug}`,
      slug,
      name: slug,
      displayName: null,
      isOwned: true,
      isPublic: true,
      ownerId: 'user-123',
      ownerDiscordId: 'user-123',
      tags: opts.tags ?? [],
      permissions: { canEdit: true, canDelete: true },
    }) satisfies PersonalitySummary;

  const createMockPersonality = (overrides = {}) => ({
    id: 'pers-123',
    name: 'test-char',
    displayName: 'Test Character',
    slug: 'test-char',
    systemPrompt: 'You are a test character.',
    model: 'anthropic/claude-3.5-sonnet',
    provider: 'openrouter',
    ...overrides,
  });

  const createMockContextBuildResult = () => ({
    context: {
      user: { discordId: 'user-123', username: 'testuser', displayName: 'testuser' },
      channelId: 'channel-123',
      serverId: 'guild-123',
      messageContent: 'Hello!',
      environment: {
        type: 'guild' as const,
        guild: { id: 'guild-123', name: 'Test Guild' },
        channel: { id: 'channel-123', name: 'test-channel', type: 'text' },
      },
    },
    personaId: 'persona-123',
    personaName: null,
    messageContent: 'Hello!',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // chat.ts calls loadPersonalityStrict; mirror loadPersonality so each test's
    // loadPersonality.mockResolvedValue(...) applies to both (override for infra).
    mockPersonalityService.loadPersonalityStrict.mockImplementation((...args) =>
      mockPersonalityService.loadPersonality(...args)
    );
    vi.useFakeTimers();
    mockMessageContextBuilder.buildContext.mockResolvedValue(createMockContextBuildResult());
    mockResolveUserContext.mockResolvedValue(buildUserContext());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('character resolution + channel validation', () => {
    it('returns "not found" when personality lookup fails', async () => {
      const ctx = createMockContext('nonexistent', 'Hello!');
      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      await handleChat(ctx);

      expect(ctx.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('not found'),
      });
    });

    it('escapes markdown in the not-found slug (defense-in-depth)', async () => {
      const ctx = createMockContext('cool_char*', 'Hello!');
      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      await handleChat(ctx);

      expect(ctx.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('cool\\_char\\*'),
      });
    });

    it('shows "try again" (not "not found") when loadPersonalityStrict throws an InfraError', async () => {
      const ctx = createMockContext('test-char', 'Hello!');
      // STRICT path: an infra failure must surface as "try again", never a false
      // "not found". The generic runCharacterTurn catch handles it.
      mockPersonalityService.loadPersonalityStrict.mockRejectedValueOnce(
        new InfraError({ ok: false, kind: 'timeout', status: 0, error: 'boom' })
      );

      await handleChat(ctx);

      expect(ctx.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Please try again'),
      });
      // Must NOT show the false "not found".
      expect(ctx.editReply).not.toHaveBeenCalledWith({
        content: expect.stringContaining('not found'),
      });
    });

    it('rejects voice channels', async () => {
      const voiceChannel = createMockChannel(ChannelType.GuildVoice);
      const ctx = createMockContext('test-char', 'Hello!', voiceChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());

      await handleChat(ctx);

      expect(ctx.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('channel type is not supported'),
      });
      expect(mockJobTracker.trackJob).not.toHaveBeenCalled();
    });

    it('STOPS the turn when the denylist/NSFW gate blocks (no job submitted)', async () => {
      // Wiring/seam test for the exact bypass this command's gate closes: when
      // runSlashChatGates returns true (blocked, already replied), the turn must
      // not proceed to config/persona resolution or job submission. A regression
      // here (e.g. an inverted null-check in resolveTurnPrereqs) would silently
      // reopen the un-gated slash path.
      const personality = createMockPersonality();
      const ctx = createMockContext('test-char', 'Hello!');
      mockPersonalityService.loadPersonalityStrict.mockResolvedValue(personality);
      vi.mocked(runSlashChatGates).mockResolvedValueOnce(true);

      await handleChat(ctx);

      // The gate saw the RIGHT data across the seam (02 §7 — not just the return
      // effect): the loaded personality and the validated channel.
      expect(vi.mocked(runSlashChatGates)).toHaveBeenCalledWith(
        ctx,
        personality,
        ctx.channel,
        expect.anything()
      );
      // ...and the turn stopped before config resolution / job submission.
      expect(vi.mocked(resolveChatLlmConfig)).not.toHaveBeenCalled();
      expect(mockGatewayClient.generate).not.toHaveBeenCalled();
      expect(mockJobTracker.trackJob).not.toHaveBeenCalled();
    });

    it('accepts GuildText channels', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', 'Hello!', channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChat(ctx);

      // Config resolution ran with the VALIDATED channel's id across the seam
      // (02 §7) — a wrong/stale channel would surface here, not just downstream.
      expect(vi.mocked(resolveChatLlmConfig)).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        channel.id
      );
      expect(channel.send).toHaveBeenCalledWith(expect.stringContaining('Hello!'));
      // Deferred reply must be resolved (deleted) so "Bot is thinking..." doesn't
      // sit in the channel until interaction-token expiry. Non-random pick path
      // delegates this to finalizeDeferredReply, which calls deleteReply.
      expect(ctx.deleteReply).toHaveBeenCalled();
      expect(mockJobTracker.trackJob).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          kind: 'slash',
          channel,
          characterSlug: 'test-char',
          isWeighInMode: false,
        })
      );
    });

    it('anchors BOTH the user row and the assistant time to the echo’s real createdAt', async () => {
      // Regression: userMessageTime was sampled with new Date() BEFORE the echo posted, so
      // the user row + assistant landed ~80ms ahead of the echo's real snowflake and the
      // extended-context merge could invert the pair. The user row's persisted timestamp AND
      // the tracked userMessageTime must both equal the echo message's createdAt.
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', 'Hello!', channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChat(ctx);

      // User row persisted at the echo's createdAt (not a pre-send new Date()).
      expect(mockConversationPersistence.saveUserMessageFromFields).toHaveBeenCalledWith(
        expect.objectContaining({ timestamp: ECHO_CREATED_AT })
      );
      // Assistant ordering (userMessageTime) anchored to the same echo createdAt → +1ms lands
      // just after the user row, consistent with the real Discord timeline.
      expect(mockJobTracker.trackJob).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ userMessageTime: ECHO_CREATED_AT })
      );
    });

    it('accepts public threads', async () => {
      const channel = createMockChannel(ChannelType.PublicThread);
      const ctx = createMockContext('test-char', 'Hello!', channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChat(ctx);

      expect(mockJobTracker.trackJob).toHaveBeenCalled();
    });

    it('accepts DM channels (push delivery removes the webhook-only restriction)', async () => {
      const channel = createMockChannel(ChannelType.DM);
      const ctx = createMockContext('test-char', 'Hello!', channel, null);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChat(ctx);

      expect(channel.send).toHaveBeenCalled();
      expect(mockJobTracker.trackJob).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          kind: 'slash',
          channel,
          guildId: null,
        })
      );
    });
  });

  describe('chat mode (with message)', () => {
    it('sends user message and persists via the fields-API', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', 'Hi there', channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChat(ctx);

      expect(channel.send).toHaveBeenCalledWith(expect.stringContaining('Hi there'));
      expect(mockConversationPersistence.saveUserMessageFromFields).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'channel-123',
          messageContent: 'Hi there',
          personaId: 'persona-123',
        })
      );
    });

    it('uses preferredName when persona has one', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', 'Hi', channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });
      mockResolveUserContext.mockResolvedValueOnce(buildUserContext({ personaName: 'Cool Name' }));

      await handleChat(ctx);

      expect(channel.send).toHaveBeenCalledWith(expect.stringContaining('**Cool Name:**'));
    });

    it('sends and persists exactly one row for a message that fits in one Discord message', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', 'Short and sweet', channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChat(ctx);

      expect(channel.send).toHaveBeenCalledTimes(1);
      expect(channel.send).toHaveBeenCalledWith('**TestUser:** Short and sweet');
      expect(mockConversationPersistence.saveUserMessageFromFields).toHaveBeenCalledTimes(1);
      expect(mockConversationPersistence.saveUserMessageFromFields).toHaveBeenCalledWith(
        expect.objectContaining({
          discordMessageId: 'user-msg-123',
          messageContent: 'Short and sweet',
          timestamp: ECHO_CREATED_AT,
        })
      );
    });

    it('chunks an over-long message into one Discord message AND one history row per chunk', async () => {
      // The `message` option accepts up to 4000 chars (Nitro parity) while a Discord
      // message caps at 2000, so the echo must split. Each chunk is its own history row;
      // the LAST chunk is the anchor the rest of the turn hangs off.
      // Short words rather than sentences, deliberately: splitMessage packs whole
      // SENTENCES first and only falls through to word packing inside an oversized
      // one, so a sentence-shaped fixture leaves up to a full sentence of slack under
      // the budget — enough to absorb a mis-sized budget and let the ≤2000 assertion
      // pass either way. Word packing lands within one word of the budget, which is
      // what makes that assertion able to fail (canary-verified).
      const filler = (label: string): string =>
        Array.from({ length: 180 }, (_, i) => `w${label}${String(i).padStart(3, '0')}`).join(' ');
      const longMessage = `${SENTINEL_START} ${filler('a')} ${SENTINEL_MIDDLE} ${filler('b')} ${SENTINEL_END}.`;
      expect(longMessage.length).toBeGreaterThan(2000);

      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', longMessage, channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChat(ctx);

      const sendCalls = vi.mocked(channel.send).mock.calls.map(call => call[0] as string);
      expect(sendCalls.length).toBeGreaterThanOrEqual(2);
      for (const sent of sendCalls) {
        // EVERY chunk carries the display prefix, and the prefix counts against the
        // 2000-char budget — dropping it from the budget makes the first chunk overflow.
        expect(sent.startsWith('**TestUser:** ')).toBe(true);
        expect(sent.length).toBeLessThanOrEqual(2000);
      }

      const echoes = await Promise.all(
        vi.mocked(channel.send).mock.results.map(result => result.value)
      );
      const persistCalls = mockConversationPersistence.saveUserMessageFromFields.mock.calls.map(
        call => call[0]
      );
      expect(persistCalls).toHaveLength(sendCalls.length);
      persistCalls.forEach((persisted, index) => {
        // Each row carries ITS OWN chunk's message id and Discord timestamp...
        expect(persisted.discordMessageId).toBe(echoes[index].id);
        expect(persisted.timestamp).toBe(echoes[index].createdAt);
        // ...and the stored content is the raw slice, never the display prefix.
        expect(persisted.messageContent).not.toContain('**TestUser:**');
      });

      // splitMessage may trim whitespace at a boundary, so assert sentinel COVERAGE
      // (nothing lost, nothing duplicated) rather than a concat-equals-input identity.
      for (const sentinel of [SENTINEL_START, SENTINEL_MIDDLE, SENTINEL_END]) {
        const carrying = persistCalls.filter(persisted =>
          persisted.messageContent.includes(sentinel)
        );
        expect(carrying).toHaveLength(1);
      }

      // The turn anchors on the LAST chunk — that id is what the worker gets as the
      // trigger, and what the assistant row's ordering derives from.
      const lastEchoId = echoes[echoes.length - 1].id;
      expect(lastEchoId).not.toBe(echoes[0].id);
      expect(mockGatewayClient.generate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ triggerMessageId: lastEchoId })
      );
      expect(mockJobTracker.trackJob).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ userMessageTime: echoes[echoes.length - 1].createdAt })
      );
    });

    it('slices an unbroken over-budget token verbatim — no ellipsis written to history', async () => {
      // A URL / base64 run longer than one Discord message has no natural boundary, so
      // splitMessage FORCE-splits it. Its default marks each fragment with a trailing
      // '...', which the echo path would store as if the user had typed it; the echo
      // opts that off, so the persisted slices must rejoin to the original byte for byte.
      const longToken = `${SENTINEL_START}${'QWxhZGRpbjpvcGVuIHNlc2FtZQ'.repeat(100)}${SENTINEL_END}`;
      expect(longToken.length).toBeGreaterThan(2000);
      expect(longToken).not.toMatch(/\s/);

      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', longToken, channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChat(ctx);

      const persisted = mockConversationPersistence.saveUserMessageFromFields.mock.calls.map(
        call => call[0].messageContent as string
      );
      expect(persisted.length).toBeGreaterThanOrEqual(2);
      // Force-splitting does no whitespace trimming, so exact concat-equality is the
      // assertion here (unlike the word-packed fixture above, which rejoins on spaces).
      expect(persisted.join('')).toBe(longToken);
      persisted.forEach(slice => {
        expect(slice).not.toContain('...');
      });

      const sendCalls = vi.mocked(channel.send).mock.calls.map(call => call[0] as string);
      sendCalls.forEach(sent => {
        expect(sent.startsWith('**TestUser:** ')).toBe(true);
        expect(sent.length).toBeLessThanOrEqual(2000);
        expect(sent).not.toContain('...');
      });
    });

    it('writes no fence markup into history when an over-budget code block is chunked', async () => {
      // The second injection path: a cut inside a fenced block normally gets extra ```
      // spliced in to keep each chunk rendering. Those fences would be stored as the
      // user's own text and fed back to the model as if they had typed them.
      const body = Array.from(
        { length: 60 },
        (_, i) => `  const ${SENTINEL_START}${i} = compute(${i}); // ${SENTINEL_END}${i}`
      ).join('\n');
      const message = '```js\n' + body + '\n```';
      expect(message.length).toBeGreaterThan(2000);
      const fenceCount = (text: string): number => (text.match(/```/g) ?? []).length;

      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', message, channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChat(ctx);

      const persisted = mockConversationPersistence.saveUserMessageFromFields.mock.calls.map(
        call => call[0].messageContent as string
      );
      expect(persisted.length).toBeGreaterThanOrEqual(2);
      expect(persisted.reduce((total, slice) => total + fenceCount(slice), 0)).toBe(
        fenceCount(message)
      );
      persisted.forEach(slice => {
        expect(slice).not.toContain('...');
      });
      // Whitespace is re-flowed at chunk boundaries by the splitter itself; what must
      // hold is that no NON-whitespace character was added or lost.
      const withoutWhitespace = (text: string): string => text.replace(/\s+/g, '');
      expect(withoutWhitespace(persisted.join(''))).toBe(withoutWhitespace(message));
    });

    it('aborts the turn without persisting anything when a later chunk fails to send', async () => {
      // Sends run to completion BEFORE any persistence, so a mid-send failure leaves the
      // earlier chunks posted in the channel but writes NO history rows and submits no job
      // — the turn falls through to the same generic error reply as any other failure.
      const channel = createMockChannel(ChannelType.GuildText);
      const firstEcho = { id: 'user-msg-123', createdAt: ECHO_CREATED_AT };
      let sendCalls = 0;
      vi.mocked(channel.send).mockImplementation(() => {
        sendCalls += 1;
        return sendCalls === 1
          ? Promise.resolve(firstEcho)
          : Promise.reject(new Error('Discord rejected the chunk'));
      });
      const filler = (label: string): string =>
        Array.from({ length: 180 }, (_, i) => `w${label}${String(i).padStart(3, '0')}`).join(' ');
      const ctx = createMockContext('test-char', `${filler('a')} ${filler('b')}`, channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChat(ctx);

      expect(sendCalls).toBeGreaterThanOrEqual(2);
      expect(mockConversationPersistence.saveUserMessageFromFields).not.toHaveBeenCalled();
      expect(mockJobTracker.trackJob).not.toHaveBeenCalled();
      expect(ctx.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to process the chat request'),
      });
    });

    it('completes the turn when one chunk fails to persist, warning instead of throwing', async () => {
      // Persistence is best-effort on every arm: a failed row costs that chunk its place
      // in history, but must not take the turn down with it.
      const filler = (label: string): string =>
        Array.from({ length: 180 }, (_, i) => `w${label}${String(i).padStart(3, '0')}`).join(' ');
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', `${filler('a')} ${filler('b')}`, channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });
      mockConversationPersistence.saveUserMessageFromFields.mockRejectedValueOnce(
        new Error('db unavailable')
      );

      await handleChat(ctx);

      expect(
        mockConversationPersistence.saveUserMessageFromFields.mock.calls.length
      ).toBeGreaterThanOrEqual(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Failed to save user message'
      );
      // The turn still reaches the gateway — the failed row is not fatal.
      expect(mockGatewayClient.generate).toHaveBeenCalled();
      expect(mockJobTracker.trackJob).toHaveBeenCalled();
    });

    it('warns without failing the turn when the SINGLE-chunk fire-and-forget persist rejects', async () => {
      // The one-chunk arm keeps the fire-and-forget strategy, so its failure surfaces
      // only on a later microtask — the other persistence-failure test above covers the
      // awaited multi-chunk arm, and the two are distinct strategies.
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', 'Short and sweet', channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });
      mockConversationPersistence.saveUserMessageFromFields.mockRejectedValueOnce(
        new Error('db unavailable')
      );

      await handleChat(ctx);
      // Let the detached persist promise's catch land.
      await vi.runAllTimersAsync();

      expect(channel.send).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Failed to save user message'
      );
      expect(mockGatewayClient.generate).toHaveBeenCalled();
      expect(mockJobTracker.trackJob).toHaveBeenCalled();
    });

    it('passes triggerMessageId to gateway.generate', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', 'Hi', channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChat(ctx);

      expect(mockGatewayClient.generate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ triggerMessageId: expect.any(String) })
      );
    });
  });

  describe('weigh-in mode (/chime-in — named character, no message)', () => {
    it('does not send a user message in weigh-in mode', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', null, channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockMessageContextBuilder.buildContext.mockResolvedValueOnce(createMockContextBuildResult());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChimeIn(ctx, 'test-char');

      // The only send should be from a possible error path — the user message
      // send path is gated on isWeighInMode === false.
      expect(channel.send).not.toHaveBeenCalled();
      expect(mockConversationPersistence.saveUserMessageFromFields).not.toHaveBeenCalled();
      expect(mockJobTracker.trackJob).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ kind: 'slash', channel, isWeighInMode: true })
      );
    });

    it('submits unconditionally — no empty-history gate', async () => {
      // A weigh-in is not gated on having prior conversation; it just generates
      // (an empty/quiet room is valid to read). With an anchor message present,
      // weigh-in submits regardless of whether the local history looks empty.
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', null, channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockMessageContextBuilder.buildContext.mockResolvedValueOnce(createMockContextBuildResult());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChimeIn(ctx, 'test-char');

      expect(channel.send).not.toHaveBeenCalledWith(
        expect.stringContaining('Start a conversation first')
      );
      expect(mockJobTracker.trackJob).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ kind: 'slash', isWeighInMode: true })
      );
    });

    it('weigh-in in a genuinely empty channel still submits (synthetic anchor, no error)', async () => {
      // Weigh-in always anchors on a field-only synthetic message regardless of
      // channel contents, so an empty channel still submits — the bot "reads an
      // empty room" and generates rather than erroring out.
      const channel = createMockChannel(ChannelType.GuildText);
      channel.messages.fetch = vi.fn().mockResolvedValue(createMockCollection([]));
      const ctx = createMockContext('test-char', null, channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockMessageContextBuilder.buildContext.mockResolvedValueOnce(createMockContextBuildResult());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChimeIn(ctx, 'test-char');

      expect(channel.send).not.toHaveBeenCalledWith(
        expect.stringContaining('No conversation history')
      );
      expect(mockJobTracker.trackJob).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ kind: 'slash', isWeighInMode: true })
      );
    });

    it('anchors on a synthetic message — never the latest channel message (regression)', async () => {
      // Regression: weigh-in (no message) used to anchor on the latest channel
      // message, so the thin-envelope assembler re-derived the current turn from
      // that message's content + voice transcript — feeding a DIFFERENT
      // character's reply (and a TTS round-trip of it) back as the "user" turn.
      // The fix anchors on a synthetic, content-only message; the latest message
      // reaches the prompt as history instead. createMockChannel's default fetch
      // returns a 'latest-msg' — the old code would have used it as the anchor;
      // the fix must not touch it.
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', null, channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockMessageContextBuilder.buildContext.mockResolvedValueOnce(createMockContextBuildResult());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChimeIn(ctx, 'test-char');

      expect(mockMessageContextBuilder.buildContext).toHaveBeenCalledTimes(1);
      const anchorArg = mockMessageContextBuilder.buildContext.mock.calls[0][0] as {
        id: string;
        content: string;
        guildId: string | null;
        channelId: string;
      };
      expect(anchorArg.id).toBe('synthetic-weigh-in-anchor');
      // The current turn is the read-the-room instruction, not a real message.
      expect(anchorArg.content).toBe(WEIGH_IN_MESSAGE);
      // guildId/channelId must be populated (they're Discord.js getters, absent on
      // the plain synthetic) so denylist scoping still works in weigh-in.
      expect(anchorArg.guildId).toBe('guild-123');
      expect(anchorArg.channelId).toBe('channel-123');
      // getAnchorMessage no longer reaches for the latest channel message at all.
      expect(channel.messages.fetch).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('replies with a generic error when the personality lookup throws', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', 'Hi', channel);
      mockPersonalityService.loadPersonality.mockRejectedValueOnce(new Error('boom'));

      await handleChat(ctx);

      expect(ctx.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to process the chat request'),
      });
      expect(mockJobTracker.trackJob).not.toHaveBeenCalled();
    });

    it('replies with a generic error when gateway.generate throws', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', 'Hi', channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockRejectedValueOnce(new Error('gateway down'));

      await handleChat(ctx);

      expect(ctx.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to process the chat request'),
      });
      expect(mockJobTracker.trackJob).not.toHaveBeenCalled();
    });

    it('falls back to channel.send when editReply throws during error handling', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', 'Hi', channel);
      mockPersonalityService.loadPersonality.mockRejectedValueOnce(new Error('boom'));
      // editReply itself throws → handleChatError's catch falls back to the channel
      vi.mocked(ctx.editReply).mockRejectedValueOnce(new Error('editReply unavailable'));

      await handleChat(ctx);

      expect(channel.send).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process the chat request')
      );
    });
  });

  describe('random-pick mode (/character random)', () => {
    it('picks a random character when none supplied and registers the slash context', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext(null, 'Hi', channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });
      mockGetCachedPersonalities.mockResolvedValueOnce({
        kind: 'ok',
        value: [
          {
            name: 'test-char',
            slug: 'test-char',
            displayName: 'Test Character',
            isOwned: true,
            isGlobal: false,
          },
        ],
      });

      await handleRandom(ctx);

      // editReply is called by finalizeDeferredReply with the picked-character notice.
      expect(ctx.editReply).toHaveBeenCalled();
      expect(mockJobTracker.trackJob).toHaveBeenCalled();
    });

    it('with no message, the random pick reads the room (weigh-in semantics)', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext(null, null, channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockMessageContextBuilder.buildContext.mockResolvedValueOnce(createMockContextBuildResult());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });
      mockGetCachedPersonalities.mockResolvedValueOnce({
        kind: 'ok',
        value: [
          {
            name: 'test-char',
            slug: 'test-char',
            displayName: 'Test Character',
            isOwned: true,
            isGlobal: false,
          },
        ],
      });

      await handleRandom(ctx);

      // No user message sent (weigh-in), but the picked-character notice still
      // posts via finalizeDeferredReply, and the job is tracked as a weigh-in.
      expect(channel.send).not.toHaveBeenCalled();
      expect(ctx.editReply).toHaveBeenCalled();
      expect(mockJobTracker.trackJob).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ kind: 'slash', isWeighInMode: true })
      );
    });

    it('forwards the tag option into the pool filter, so only tagged characters can be picked', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext(null, 'Hi', channel, createMockGuild(), 'fantasy');
      mockPersonalityService.loadPersonalityStrict.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });
      mockGetCachedPersonalities.mockResolvedValueOnce({
        kind: 'ok',
        value: [
          makeSummary('untagged-char', { tags: [] }),
          makeSummary('tagged-char', { tags: ['fantasy'] }),
        ],
      });

      await handleRandom(ctx);

      // Seam assertion: the slug that reaches the personality loader is the one
      // the tag filter selected. A dropped `tag` option would let the untagged
      // character through here while every other assertion still passed.
      expect(mockPersonalityService.loadPersonalityStrict).toHaveBeenCalledWith(
        'tagged-char',
        'user-123'
      );
    });

    it('reports an unmatched tag instead of picking from the whole pool', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext(null, 'Hi', channel, createMockGuild(), 'western');
      mockGetCachedPersonalities.mockResolvedValueOnce({
        kind: 'ok',
        value: [makeSummary('tagged-char', { tags: ['fantasy'] })],
      });

      await handleRandom(ctx);

      expect(mockPersonalityService.loadPersonalityStrict).not.toHaveBeenCalled();
      expect(ctx.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('No characters carry the tag'),
      });
    });
  });
});
