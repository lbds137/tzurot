/**
 * DM Session Processor Tests
 *
 * Tests sticky DM personality sessions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChannelType, Collection } from 'discord.js';
import { DMSessionProcessor } from './DMSessionProcessor.js';
import type { Message, DMChannel, Client } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { InfraError } from '@tzurot/clients';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import type { PersonalityMessageHandler } from '../services/PersonalityMessageHandler.js';

// Mock VoiceMessageProcessor
vi.mock('./VoiceMessageProcessor.js', () => ({
  VoiceMessageProcessor: {
    getVoiceTranscript: vi.fn(),
  },
}));

// Mock the module-level gateway service calls the processor uses.
vi.mock('../utils/gatewayServiceCalls.js', () => ({
  getChannelSettingsCached: vi.fn(),
  setDmSessionPersonality: vi.fn(),
  lookupPersonalityFromMessage: vi.fn(),
}));

// Mock nsfwVerification
vi.mock('../utils/nsfwVerification.js', () => ({
  isDMChannel: vi.fn(),
  checkNsfwVerification: vi.fn(),
  sendNsfwVerificationMessage: vi.fn().mockResolvedValue(undefined),
  trackPendingVerificationMessage: vi.fn(),
  NSFW_VERIFICATION_MESSAGE: '**Age Verification Required**\n\nMocked message',
  NSFW_VERIFICATION_CHECK_FAILED_MESSAGE: "⚠️ Couldn't verify your age status right now.",
}));

// The processor mints a UserClient via `clientsForUser(message.author)` to pass
// into checkNsfwVerification. The real factory needs INTERNAL_SERVICE_SECRET
// from startup config; the test stubs it with a sentinel.
vi.mock('../utils/gatewayClients.js', () => ({
  clientsForUser: vi.fn(() => ({
    userClient: { actor: 'mock-user' },
    ownerClient: { actor: 'mock-owner' },
  })),
}));

import { VoiceMessageProcessor } from './VoiceMessageProcessor.js';
import {
  isDMChannel,
  checkNsfwVerification,
  sendNsfwVerificationMessage,
  trackPendingVerificationMessage,
} from '../utils/nsfwVerification.js';
import {
  getChannelSettingsCached,
  setDmSessionPersonality,
  lookupPersonalityFromMessage,
} from '../utils/gatewayServiceCalls.js';

function createMockDMChannel(overrides: Partial<DMChannel> = {}): DMChannel {
  const messagesCollection = new Collection<string, Message>();
  return {
    id: 'dm-channel-123',
    type: ChannelType.DM,
    messages: {
      fetch: vi.fn().mockResolvedValue(messagesCollection),
    },
    ...overrides,
  } as unknown as DMChannel;
}

function createMockBotMessage(options: { id: string; content: string; botId: string }): Message {
  return {
    id: options.id,
    content: options.content,
    author: {
      id: options.botId,
      bot: true,
    },
  } as unknown as Message;
}

function createMockMessage(options?: {
  content?: string;
  channelId?: string;
  userId?: string;
  channel?: DMChannel;
  botId?: string;
}): Message {
  const channel = options?.channel ?? createMockDMChannel();
  return {
    id: '123456789',
    content: options?.content ?? 'Hello world',
    channelId: options?.channelId ?? channel.id,
    channel,
    author: {
      id: options?.userId ?? 'user-123',
      username: 'testuser',
      bot: false,
    },
    client: {
      user: {
        id: options?.botId ?? 'bot-123',
      },
    } as Client,
    reply: vi.fn().mockResolvedValue({
      id: 'help-msg-123',
      delete: vi.fn().mockResolvedValue(undefined),
    }),
  } as unknown as Message;
}

const mockLilithPersonality = {
  id: 'lilith-id',
  name: 'Lilith',
  slug: 'lilith',
  displayName: 'Lilith',
  systemPrompt: 'Lilith personality',
  model: 'anthropic/claude-sonnet-4.5',
  provider: 'openrouter',
  temperature: 0.8,
  avatarUrl: 'https://example.com/lilith.png',
} as unknown as LoadedPersonality;

describe('DMSessionProcessor', () => {
  let processor: DMSessionProcessor;
  let mockMultiTagPersistence: {
    wasDMBackfillTried: ReturnType<typeof vi.fn>;
    markDMBackfillTried: ReturnType<typeof vi.fn>;
    clearDMBackfillTried: ReturnType<typeof vi.fn>;
  };
  let mockPersonalityService: {
    loadPersonality: ReturnType<typeof vi.fn>;
    loadPersonalityStrict: ReturnType<typeof vi.fn>;
  };
  let mockPersonalityHandler: {
    handleMessage: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Default: isDMChannel returns false (override in specific tests)
    vi.mocked(isDMChannel).mockReturnValue(false);
    vi.mocked(VoiceMessageProcessor.getVoiceTranscript).mockReturnValue(undefined);
    // Default: user is NSFW verified (override in specific tests)
    vi.mocked(checkNsfwVerification).mockResolvedValue({
      kind: 'ok',
      value: {
        nsfwVerified: true,
        nsfwVerifiedAt: new Date().toISOString(),
      },
    });
    vi.mocked(trackPendingVerificationMessage).mockResolvedValue(undefined);
    // (DMSessionProcessor no longer parses mentions itself — PersonalityTriggerProcessor
    // earlier in the chain handles tagged messages.)

    // Default: no DM-session row in channel_settings — tests exercise the
    // history-scan fallback. Tests that want to validate the fast path
    // override this per-case.
    vi.mocked(getChannelSettingsCached).mockResolvedValue({
      hasSettings: false,
    } as Awaited<ReturnType<typeof getChannelSettingsCached>>);
    // Lazy-backfill write — best-effort, fire-and-forget. Default to
    // resolved-undefined; specific tests can assert it was called.
    vi.mocked(setDmSessionPersonality).mockResolvedValue(undefined);
    vi.mocked(lookupPersonalityFromMessage).mockResolvedValue(null);

    mockPersonalityService = {
      loadPersonality: vi.fn(),
      loadPersonalityStrict: vi.fn(),
    };
    // DMSessionProcessor's active-session path uses loadPersonalityStrict;
    // mirror loadPersonality so each test's mockResolvedValue applies to both.
    mockPersonalityService.loadPersonalityStrict.mockImplementation((...args: unknown[]) =>
      (mockPersonalityService.loadPersonality as (...a: unknown[]) => unknown)(...args)
    );

    mockPersonalityHandler = {
      handleMessage: vi.fn(),
    };

    // MultiTagPersistence is consulted for the backfill-tried sentinel. Default
    // mocks return "never tried" + no-op write; specific tests override per case.
    mockMultiTagPersistence = {
      wasDMBackfillTried: vi.fn().mockResolvedValue(false),
      markDMBackfillTried: vi.fn().mockResolvedValue(undefined),
      clearDMBackfillTried: vi.fn().mockResolvedValue(undefined),
    };

    processor = new DMSessionProcessor(
      mockPersonalityService as unknown as IPersonalityLoader,
      mockPersonalityHandler as unknown as PersonalityMessageHandler,
      mockMultiTagPersistence as never
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Channel type filtering', () => {
    it('should return false for non-DM channels', async () => {
      const message = createMockMessage();
      vi.mocked(isDMChannel).mockReturnValue(false);

      const result = await processor.process(message);

      expect(result).toBe(false);
      expect(vi.mocked(lookupPersonalityFromMessage)).not.toHaveBeenCalled();
    });

    it('should process DM channels', async () => {
      const channel = createMockDMChannel();
      const message = createMockMessage({ channel });
      vi.mocked(isDMChannel).mockReturnValue(true);

      // No active session
      const result = await processor.process(message);

      expect(result).toBe(true); // Handled (sent help message)
    });
  });

  describe('Active session detection', () => {
    it('should find active personality from recent bot message with prefix', async () => {
      const botId = 'bot-123';
      const botMessage = createMockBotMessage({
        id: 'bot-msg-123',
        content: '**Lilith:** Hello there!',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      messagesCollection.set(botMessage.id, botMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId });
      vi.mocked(isDMChannel).mockReturnValue(true);

      vi.mocked(lookupPersonalityFromMessage).mockResolvedValue({
        personalityId: 'lilith-id',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(vi.mocked(lookupPersonalityFromMessage)).toHaveBeenCalledWith('bot-msg-123');
      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith('lilith-id', 'user-123');
      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockLilithPersonality,
        'Hello world',
        { isAutoResponse: true }
      );
      // Lazy-backfill write: after a successful history scan, the discovered
      // personality is recorded in channel_settings so the next bare DM hits
      // the fast (cached) path instead of re-scanning Discord history.
      expect(vi.mocked(setDmSessionPersonality)).toHaveBeenCalledWith(message.channelId, 'lilith');
    });

    it('should skip bot messages without personality prefix', async () => {
      const botId = 'bot-123';

      // Ephemeral message without prefix (like NSFW verification)
      const ephemeralMessage = createMockBotMessage({
        id: 'ephemeral-msg',
        content: '**Age Verification Required**\n\nTo chat with me...',
        botId,
      });

      // Personality message with prefix
      const personalityMessage = createMockBotMessage({
        id: 'personality-msg',
        content: '**Lilith:** Older message here',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      // Ephemeral is more recent (first in collection)
      messagesCollection.set(ephemeralMessage.id, ephemeralMessage);
      messagesCollection.set(personalityMessage.id, personalityMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId });
      vi.mocked(isDMChannel).mockReturnValue(true);

      vi.mocked(lookupPersonalityFromMessage).mockResolvedValue({
        personalityId: 'lilith-id',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      await processor.process(message);

      // Should have skipped ephemeral message and found personality message
      expect(vi.mocked(lookupPersonalityFromMessage)).toHaveBeenCalledWith('personality-msg');
      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalled();
    });

    it('should skip non-bot messages when scanning', async () => {
      const botId = 'bot-123';

      // User message (not from bot)
      const userMessage = {
        id: 'user-msg',
        content: '**Lilith:** Fake prefix from user',
        author: { id: 'user-123', bot: false },
      } as unknown as Message;

      // Bot message
      const botMessage = createMockBotMessage({
        id: 'bot-msg',
        content: '**Lilith:** Real bot message',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      messagesCollection.set(userMessage.id, userMessage);
      messagesCollection.set(botMessage.id, botMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId });
      vi.mocked(isDMChannel).mockReturnValue(true);

      vi.mocked(lookupPersonalityFromMessage).mockResolvedValue({
        personalityId: 'lilith-id',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      await processor.process(message);

      // Should only look up bot message, not user message
      expect(vi.mocked(lookupPersonalityFromMessage)).toHaveBeenCalledWith('bot-msg');
      expect(vi.mocked(lookupPersonalityFromMessage)).not.toHaveBeenCalledWith('user-msg');
    });

    it('should try next message if conversation lookup returns null', async () => {
      const botId = 'bot-123';

      const oldMessage = createMockBotMessage({
        id: 'old-msg',
        content: '**OldPersonality:** Very old message',
        botId,
      });

      const recentMessage = createMockBotMessage({
        id: 'recent-msg',
        content: '**Lilith:** Recent message',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      // Recent first (Discord returns newest first)
      messagesCollection.set(recentMessage.id, recentMessage);
      messagesCollection.set(oldMessage.id, oldMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId });
      vi.mocked(isDMChannel).mockReturnValue(true);

      // First lookup (recent) returns null, second (old) returns personality
      vi.mocked(lookupPersonalityFromMessage)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ personalityId: 'old-personality-id' });

      const oldPersonality = {
        ...mockLilithPersonality,
        id: 'old-personality-id',
        displayName: 'OldPersonality',
      };
      mockPersonalityService.loadPersonality.mockResolvedValue(oldPersonality);

      await processor.process(message);

      expect(vi.mocked(lookupPersonalityFromMessage)).toHaveBeenCalledTimes(2);
      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith(
        'old-personality-id',
        'user-123'
      );
    });
  });

  describe('Help message', () => {
    it('should send help message when no active session', async () => {
      const channel = createMockDMChannel();
      const message = createMockMessage({ channel });
      vi.mocked(isDMChannel).mockReturnValue(true);

      // Empty messages collection (no previous conversations)
      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(message.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('No active conversation'),
      });
      expect(message.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('@character_name'),
      });
    });

    it('should send help message when personality not accessible', async () => {
      const botId = 'bot-123';
      const botMessage = createMockBotMessage({
        id: 'bot-msg-123',
        content: '**PrivateBot:** Hello',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      messagesCollection.set(botMessage.id, botMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId });
      vi.mocked(isDMChannel).mockReturnValue(true);

      vi.mocked(lookupPersonalityFromMessage).mockResolvedValue({
        personalityId: 'private-id',
      });
      // User doesn't have access
      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(message.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('No active conversation'),
      });
      expect(mockPersonalityHandler.handleMessage).not.toHaveBeenCalled();
    });

    it('should delete help message after 30 seconds', async () => {
      const channel = createMockDMChannel();
      const mockDelete = vi.fn().mockResolvedValue(undefined);
      const message = createMockMessage({ channel });
      (message.reply as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'help-msg-123',
        delete: mockDelete,
      });
      vi.mocked(isDMChannel).mockReturnValue(true);

      await processor.process(message);

      // Help message sent but not deleted yet
      expect(message.reply).toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();

      // Advance time by 30 seconds
      await vi.advanceTimersByTimeAsync(30_000);

      expect(mockDelete).toHaveBeenCalledTimes(1);
    });

    it('should handle help message deletion failure gracefully', async () => {
      const channel = createMockDMChannel();
      const mockDelete = vi.fn().mockRejectedValue(new Error('Message not found'));
      const message = createMockMessage({ channel });
      (message.reply as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'help-msg-123',
        delete: mockDelete,
      });
      vi.mocked(isDMChannel).mockReturnValue(true);

      await processor.process(message);

      // Should not throw when deletion fails
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should handle help message send failure gracefully', async () => {
      const channel = createMockDMChannel();
      const message = createMockMessage({ channel });
      (message.reply as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Cannot send messages to this user')
      );
      vi.mocked(isDMChannel).mockReturnValue(true);

      // Should not throw
      const result = await processor.process(message);
      expect(result).toBe(true);
    });
  });

  describe('Voice transcript integration', () => {
    it('should use voice transcript when available', async () => {
      const botId = 'bot-123';
      const botMessage = createMockBotMessage({
        id: 'bot-msg-123',
        content: '**Lilith:** Hello',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      messagesCollection.set(botMessage.id, botMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId, content: 'Text content' });
      vi.mocked(isDMChannel).mockReturnValue(true);
      vi.mocked(VoiceMessageProcessor.getVoiceTranscript).mockReturnValue('Voice transcript text');

      vi.mocked(lookupPersonalityFromMessage).mockResolvedValue({
        personalityId: 'lilith-id',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockLilithPersonality,
        'Voice transcript text', // Voice transcript used
        { isAutoResponse: true }
      );
    });
  });

  describe('Error handling', () => {
    it('should handle message fetch errors gracefully', async () => {
      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Discord API error')
      );

      const message = createMockMessage({ channel });
      vi.mocked(isDMChannel).mockReturnValue(true);

      // Should not throw, should send help message instead
      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(message.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('No active conversation'),
      });
    });

    it('should handle missing bot ID gracefully', async () => {
      const channel = createMockDMChannel();
      const message = createMockMessage({ channel });
      // Override client to have no user
      (message.client as unknown as { user: null }).user = null;
      vi.mocked(isDMChannel).mockReturnValue(true);

      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(message.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('No active conversation'),
      });
    });
  });

  describe('isAutoResponse flag', () => {
    it('should always pass isAutoResponse: true when handling DM session messages', async () => {
      const botId = 'bot-123';
      const botMessage = createMockBotMessage({
        id: 'bot-msg-123',
        content: '**Lilith:** Hello',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      messagesCollection.set(botMessage.id, botMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId });
      vi.mocked(isDMChannel).mockReturnValue(true);

      vi.mocked(lookupPersonalityFromMessage).mockResolvedValue({
        personalityId: 'lilith-id',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        { isAutoResponse: true }
      );
    });
  });

  describe('Backfill-tried sentinel', () => {
    it('skips history scan when wasDMBackfillTried returns true', async () => {
      const botId = 'bot-123';
      const channel = createMockDMChannel();
      const message = createMockMessage({ channel, botId, content: 'bare DM' });
      vi.mocked(isDMChannel).mockReturnValue(true);

      // No channel_settings row exists.
      vi.mocked(getChannelSettingsCached).mockResolvedValue({
        hasSettings: false,
      } as Awaited<ReturnType<typeof getChannelSettingsCached>>);
      // Sentinel says we already tried; the history scan should NOT run.
      mockMultiTagPersistence.wasDMBackfillTried.mockResolvedValue(true);

      const result = await processor.process(message);

      // No history scan = no Discord API call to messages.fetch
      expect(channel.messages.fetch).not.toHaveBeenCalled();
      // Empty session → help message
      expect(result).toBe(true);
      // Did not re-mark (already marked).
      expect(mockMultiTagPersistence.markDMBackfillTried).not.toHaveBeenCalled();
    });

    it('marks backfill tried after a history scan that finds nothing', async () => {
      const botId = 'bot-123';
      const channel = createMockDMChannel();
      // No bot messages → history scan returns null.
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Collection<string, Message>()
      );

      const message = createMockMessage({
        channel,
        botId,
        content: 'bare DM',
        channelId: 'channel-empty',
      });
      vi.mocked(isDMChannel).mockReturnValue(true);
      vi.mocked(getChannelSettingsCached).mockResolvedValue({
        hasSettings: false,
      } as Awaited<ReturnType<typeof getChannelSettingsCached>>);
      mockMultiTagPersistence.wasDMBackfillTried.mockResolvedValue(false);

      await processor.process(message);

      // Scan ran...
      expect(channel.messages.fetch).toHaveBeenCalledOnce();
      // ...and we recorded that we tried, so the NEXT bare DM doesn't repeat.
      expect(mockMultiTagPersistence.markDMBackfillTried).toHaveBeenCalledWith('channel-empty');
    });
  });

  describe('Active-session routing', () => {
    it('should process normally when no explicit mention', async () => {
      const botId = 'bot-123';
      const botMessage = createMockBotMessage({
        id: 'bot-msg-123',
        content: '**Lilith:** Hello',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      messagesCollection.set(botMessage.id, botMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId, content: 'just a normal message' });
      vi.mocked(isDMChannel).mockReturnValue(true);

      vi.mocked(lookupPersonalityFromMessage).mockResolvedValue({
        personalityId: 'lilith-id',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      const result = await processor.process(message);

      // Should process via active session
      expect(result).toBe(true);
      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockLilithPersonality,
        'just a normal message',
        { isAutoResponse: true }
      );
    });

    it('uses channel_settings fast path when activatedPersonalityId is set (no history scan)', async () => {
      // The steady-state path: any DM that has ever had a multi-tag fan-out
      // has channel_settings.activatedPersonalityId written. Subsequent bare
      // DMs must hit the fast path and skip the expensive Discord history
      // scan entirely.
      const channel = createMockDMChannel();
      const message = createMockMessage({ channel, botId: 'bot-123', content: 'follow-up' });
      vi.mocked(isDMChannel).mockReturnValue(true);

      vi.mocked(getChannelSettingsCached).mockResolvedValue({
        hasSettings: true,
        settings: {
          activatedPersonalityId: 'lilith-id',
          personalitySlug: 'lilith',
          personalityName: 'Lilith',
          autoRespond: true,
        },
      } as Awaited<ReturnType<typeof getChannelSettingsCached>>);
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      const result = await processor.process(message);

      expect(result).toBe(true);
      // The Discord history scan MUST NOT have been called — that's the
      // whole point of the fast path.
      expect(channel.messages.fetch).not.toHaveBeenCalled();
      // Backfill-tried sentinel check must also be skipped (only consulted
      // on the slow path).
      expect(mockMultiTagPersistence.wasDMBackfillTried).not.toHaveBeenCalled();
      // Personality loaded for access gating + routed to handler.
      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith(
        'lilith-id',
        message.author.id
      );
      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockLilithPersonality,
        'follow-up',
        { isAutoResponse: true }
      );
    });

    it('surfaces "try again" (not the help message) when an active-session load hits an infra failure', async () => {
      const channel = createMockDMChannel();
      const message = createMockMessage({ channel, botId: 'bot-123', content: 'follow-up' });
      vi.mocked(isDMChannel).mockReturnValue(true);

      vi.mocked(getChannelSettingsCached).mockResolvedValue({
        hasSettings: true,
        settings: {
          activatedPersonalityId: 'lilith-id',
          personalitySlug: 'lilith',
          personalityName: 'Lilith',
          autoRespond: true,
        },
      } as Awaited<ReturnType<typeof getChannelSettingsCached>>);

      // The session IS active, but the strict load fails for an infra reason. The
      // user must see "try again", NOT the "no active conversation" help message.
      mockPersonalityService.loadPersonalityStrict.mockRejectedValueOnce(
        new InfraError({ ok: false, kind: 'timeout', status: 0, error: 'boom' })
      );

      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('try again'));
      // Must NOT fall through to the help path (that's the false-"no session" bug).
      expect(mockPersonalityHandler.handleMessage).not.toHaveBeenCalled();
    });

    it('re-throws a non-infra error from an active-session load (not swallowed as a miss)', async () => {
      const channel = createMockDMChannel();
      const message = createMockMessage({ channel, botId: 'bot-123', content: 'follow-up' });
      vi.mocked(isDMChannel).mockReturnValue(true);

      vi.mocked(getChannelSettingsCached).mockResolvedValue({
        hasSettings: true,
        settings: {
          activatedPersonalityId: 'lilith-id',
          personalitySlug: 'lilith',
          personalityName: 'Lilith',
          autoRespond: true,
        },
      } as Awaited<ReturnType<typeof getChannelSettingsCached>>);

      // A thrown error that is neither InfraError nor GatewayClientError is a real
      // bug — it must propagate, not get silently turned into the help path.
      mockPersonalityService.loadPersonalityStrict.mockRejectedValueOnce(new Error('unexpected'));

      await expect(processor.process(message)).rejects.toThrow('unexpected');
      expect(mockPersonalityHandler.handleMessage).not.toHaveBeenCalled();
    });
  });

  describe('NSFW verification', () => {
    it('should block unverified users and send verification message', async () => {
      const channel = createMockDMChannel();
      const message = createMockMessage({ channel });
      vi.mocked(isDMChannel).mockReturnValue(true);
      vi.mocked(checkNsfwVerification).mockResolvedValue({
        kind: 'ok',
        value: {
          nsfwVerified: false,
          nsfwVerifiedAt: null,
        },
      });

      const result = await processor.process(message);

      expect(result).toBe(true); // Consumed message
      expect(sendNsfwVerificationMessage).toHaveBeenCalledWith(message);
      // Should NOT check for active session or send help message
      expect(vi.mocked(lookupPersonalityFromMessage)).not.toHaveBeenCalled();
    });

    it('should surface distinct retry message when NSFW check fails (fail-closed)', async () => {
      const channel = createMockDMChannel();
      const message = createMockMessage({ channel });
      vi.mocked(isDMChannel).mockReturnValue(true);
      vi.mocked(checkNsfwVerification).mockResolvedValue({
        kind: 'error',
        error: 'Gateway timeout',
      });

      const result = await processor.process(message);

      expect(result).toBe(true); // Consumed message
      expect(message.reply).toHaveBeenCalledWith(
        expect.stringContaining("Couldn't verify your age status")
      );
      // Must NOT re-onboard a previously-verified user through the full
      // education embed — that's the bug this path is fixing.
      expect(sendNsfwVerificationMessage).not.toHaveBeenCalled();
      expect(vi.mocked(lookupPersonalityFromMessage)).not.toHaveBeenCalled();
    });

    it('should allow verified users to continue', async () => {
      const channel = createMockDMChannel();
      const message = createMockMessage({ channel });
      vi.mocked(isDMChannel).mockReturnValue(true);
      vi.mocked(checkNsfwVerification).mockResolvedValue({
        kind: 'ok',
        value: {
          nsfwVerified: true,
          nsfwVerifiedAt: new Date().toISOString(),
        },
      });

      // No active session - should get help message (not verification message)
      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(message.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('No active conversation'),
      });
      expect(sendNsfwVerificationMessage).not.toHaveBeenCalled();
    });

    it('should check NSFW verification before checking for active personality', async () => {
      const botId = 'bot-123';
      const botMessage = createMockBotMessage({
        id: 'bot-msg-123',
        content: '**Lilith:** Hello',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      messagesCollection.set(botMessage.id, botMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId });
      vi.mocked(isDMChannel).mockReturnValue(true);
      vi.mocked(checkNsfwVerification).mockResolvedValue({
        kind: 'ok',
        value: {
          nsfwVerified: false,
          nsfwVerifiedAt: null,
        },
      });

      vi.mocked(lookupPersonalityFromMessage).mockResolvedValue({
        personalityId: 'lilith-id',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      const result = await processor.process(message);

      // Even though there's an active personality, should block for verification
      expect(result).toBe(true);
      expect(sendNsfwVerificationMessage).toHaveBeenCalledWith(message);
      expect(mockPersonalityHandler.handleMessage).not.toHaveBeenCalled();
    });
  });
});
