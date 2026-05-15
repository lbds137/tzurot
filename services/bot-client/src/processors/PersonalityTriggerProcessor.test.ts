/**
 * Tests for PersonalityTriggerProcessor — the consolidated entry point that
 * resolves reply + activation + mentions and hands the slot list to the
 * MultiTagCoordinator.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelType, type Message } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types';
import { PersonalityTriggerProcessor } from './PersonalityTriggerProcessor.js';

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    getConfig: () => ({ BOT_MENTION_CHAR: '@' }),
    isTypingChannel: (channel: { type?: number }) =>
      channel.type === ChannelType.GuildText || channel.type === ChannelType.DM,
  };
});

vi.mock('../utils/personalityMentionParser.js', () => ({
  findPersonalityMentions: vi.fn(),
}));

vi.mock('./VoiceMessageProcessor.js', () => ({
  VoiceMessageProcessor: { getVoiceTranscript: vi.fn() },
}));

vi.mock('../utils/forwardedMessageUtils.js', () => ({
  isForwardedMessage: vi.fn().mockReturnValue(false),
}));

vi.mock('../utils/messageTypeUtils.js', () => ({
  getEffectiveContent: vi.fn((m: Message) => m.content),
}));

vi.mock('../utils/discordChannelTypes.js', () => ({
  getThreadParentId: vi.fn().mockReturnValue(null),
}));

vi.mock('./notificationCache.js', () => ({
  shouldNotifyUser: vi.fn().mockReturnValue(true),
}));

import { findPersonalityMentions } from '../utils/personalityMentionParser.js';
import { isForwardedMessage } from '../utils/forwardedMessageUtils.js';
import { getThreadParentId } from '../utils/discordChannelTypes.js';

function buildPersonality(name: string): LoadedPersonality {
  return {
    id: `id-${name}`,
    name,
    displayName: name,
    slug: name.toLowerCase(),
  } as unknown as LoadedPersonality;
}

function buildMessage(overrides: Record<string, unknown> = {}): Message {
  return {
    id: 'msg-1',
    content: 'hi',
    author: { id: 'user-1' },
    guildId: 'guild-1',
    channelId: 'channel-1',
    channel: { id: 'channel-1', type: ChannelType.GuildText },
    reference: null,
    reply: vi.fn().mockResolvedValue(undefined),
    client: { user: { id: 'bot-1' } },
    ...overrides,
  } as unknown as Message;
}

describe('PersonalityTriggerProcessor', () => {
  let personalityService: { loadPersonality: ReturnType<typeof vi.fn> };
  let replyResolver: { resolvePersonality: ReturnType<typeof vi.fn> };
  let gatewayClient: { getChannelSettings: ReturnType<typeof vi.fn> };
  let coordinator: { startFanOut: ReturnType<typeof vi.fn> };
  let processor: PersonalityTriggerProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    personalityService = { loadPersonality: vi.fn() };
    replyResolver = { resolvePersonality: vi.fn().mockResolvedValue(null) };
    gatewayClient = {
      getChannelSettings: vi.fn().mockResolvedValue({ hasSettings: false }),
    };
    coordinator = { startFanOut: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(findPersonalityMentions).mockResolvedValue([]);
    vi.mocked(isForwardedMessage).mockReturnValue(false);
    processor = new PersonalityTriggerProcessor({
      personalityService: personalityService as never,
      replyResolver: replyResolver as never,
      gatewayClient: gatewayClient as never,
      coordinator: coordinator as never,
    });
  });

  describe('Pass-through cases', () => {
    it('returns false for forwarded messages', async () => {
      vi.mocked(isForwardedMessage).mockReturnValueOnce(true);
      const result = await processor.process(buildMessage());
      expect(result).toBe(false);
      expect(coordinator.startFanOut).not.toHaveBeenCalled();
    });

    it('returns false when no trigger sources match', async () => {
      const result = await processor.process(buildMessage());
      expect(result).toBe(false);
      expect(coordinator.startFanOut).not.toHaveBeenCalled();
    });

    it('returns false for non-TypingChannel types', async () => {
      const result = await processor.process(
        buildMessage({
          channel: { id: 'voice-1', type: ChannelType.GuildVoice } as Message['channel'],
        })
      );
      expect(result).toBe(false);
    });
  });

  describe('Mention-only triggers', () => {
    it('hands a single-mention slot to the coordinator', async () => {
      const alice = buildPersonality('Alice');
      vi.mocked(findPersonalityMentions).mockResolvedValue([{ personality: alice, startIndex: 0 }]);

      const result = await processor.process(buildMessage({ content: '@Alice hi' }));

      expect(result).toBe(true);
      expect(coordinator.startFanOut).toHaveBeenCalledOnce();
      const arg = coordinator.startFanOut.mock.calls[0][0];
      expect(arg.slots).toHaveLength(1);
      expect(arg.slots[0]).toMatchObject({
        personality: alice,
        source: 'mention',
        isAutoResponse: false,
      });
    });

    it('passes multiple mentions in textual order', async () => {
      const alice = buildPersonality('Alice');
      const bob = buildPersonality('Bob');
      vi.mocked(findPersonalityMentions).mockResolvedValue([
        { personality: alice, startIndex: 0 },
        { personality: bob, startIndex: 7 },
      ]);

      await processor.process(buildMessage({ content: '@Alice @Bob hi' }));

      const arg = coordinator.startFanOut.mock.calls[0][0];
      expect(arg.slots.map((s: { personality: LoadedPersonality }) => s.personality.name)).toEqual([
        'Alice',
        'Bob',
      ]);
    });
  });

  describe('Reply triggers', () => {
    it('puts the reply-to-character in slot 0', async () => {
      const alice = buildPersonality('Alice');
      replyResolver.resolvePersonality.mockResolvedValue(alice);

      await processor.process(buildMessage({ reference: { messageId: 'ref-1' } as never }));

      const arg = coordinator.startFanOut.mock.calls[0][0];
      expect(arg.slots[0]).toMatchObject({
        personality: alice,
        source: 'reply',
        isAutoResponse: false,
      });
    });

    it('combines reply + mentions (reply first)', async () => {
      const alice = buildPersonality('Alice');
      const bob = buildPersonality('Bob');
      const carol = buildPersonality('Carol');
      replyResolver.resolvePersonality.mockResolvedValue(alice);
      vi.mocked(findPersonalityMentions).mockResolvedValue([
        { personality: bob, startIndex: 0 },
        { personality: carol, startIndex: 5 },
      ]);

      await processor.process(
        buildMessage({ reference: { messageId: 'ref-1' } as never, content: '@Bob @Carol hi' })
      );

      const arg = coordinator.startFanOut.mock.calls[0][0];
      expect(arg.slots.map((s: { personality: LoadedPersonality }) => s.personality.name)).toEqual([
        'Alice',
        'Bob',
        'Carol',
      ]);
      expect(arg.slots[0].source).toBe('reply');
      expect(arg.slots[1].source).toBe('mention');
    });
  });

  describe('Activated channel triggers', () => {
    it('puts the activated personality in slot 1 with isAutoResponse=true', async () => {
      const ambient = buildPersonality('Ambient');
      const alice = buildPersonality('Alice');
      gatewayClient.getChannelSettings.mockResolvedValue({
        hasSettings: true,
        settings: { personalitySlug: 'ambient', personalityName: 'Ambient' },
      });
      personalityService.loadPersonality.mockResolvedValue(ambient);
      vi.mocked(findPersonalityMentions).mockResolvedValue([{ personality: alice, startIndex: 0 }]);

      await processor.process(buildMessage({ content: '@Alice hi' }));

      const arg = coordinator.startFanOut.mock.calls[0][0];
      expect(arg.slots).toHaveLength(2);
      // Note: no reply, so activation takes slot 0 in the ordered output; the
      // semantic "slot 1" labeling refers to SlotResolver's input precedence,
      // not the dense output index.
      expect(arg.slots[0]).toMatchObject({
        personality: ambient,
        source: 'activation',
        isAutoResponse: true,
      });
      expect(arg.slots[1]).toMatchObject({
        personality: alice,
        source: 'mention',
        isAutoResponse: false,
      });
    });

    it('does not include activated personality in DM channels', async () => {
      // DM channels have no guild → activation lookup is skipped.
      const alice = buildPersonality('Alice');
      gatewayClient.getChannelSettings.mockResolvedValue({
        hasSettings: true,
        settings: { personalitySlug: 'ambient', personalityName: 'Ambient' },
      });
      vi.mocked(findPersonalityMentions).mockResolvedValue([{ personality: alice, startIndex: 0 }]);

      await processor.process(
        buildMessage({
          guildId: null,
          channel: { id: 'dm-1', type: ChannelType.DM } as Message['channel'],
        })
      );

      // The processor shouldn't have called getChannelSettings at all
      expect(gatewayClient.getChannelSettings).not.toHaveBeenCalled();
      const arg = coordinator.startFanOut.mock.calls[0][0];
      expect(arg.slots).toHaveLength(1);
      expect(arg.slots[0].source).toBe('mention');
    });

    it('sends notice + omits slot when activated personality is inaccessible', async () => {
      gatewayClient.getChannelSettings.mockResolvedValue({
        hasSettings: true,
        settings: { personalitySlug: 'private', personalityName: 'Private' },
      });
      personalityService.loadPersonality.mockResolvedValue(null);
      const alice = buildPersonality('Alice');
      vi.mocked(findPersonalityMentions).mockResolvedValue([{ personality: alice, startIndex: 0 }]);
      const message = buildMessage({ content: '@Alice hi' });

      const result = await processor.process(message);

      expect(message.reply).toHaveBeenCalled();
      const arg = coordinator.startFanOut.mock.calls[0][0];
      expect(arg.slots).toHaveLength(1);
      expect(arg.slots[0].source).toBe('mention');
      expect(result).toBe(true);
    });
  });

  describe('Thread-channel activation inheritance', () => {
    it('falls back to parent channel when the thread has NO settings row', async () => {
      const parentAmbient = buildPersonality('ParentAmbient');
      // Thread has no settings — should fall back to parent
      gatewayClient.getChannelSettings
        .mockResolvedValueOnce({ hasSettings: false }) // thread
        .mockResolvedValueOnce({
          // parent
          hasSettings: true,
          settings: { personalitySlug: 'parentambient', personalityName: 'ParentAmbient' },
        });
      personalityService.loadPersonality.mockResolvedValue(parentAmbient);
      vi.mocked(getThreadParentId).mockReturnValueOnce('parent-channel-1');

      await processor.process(buildMessage({ content: 'hi' }));

      expect(coordinator.startFanOut).toHaveBeenCalledOnce();
      const arg = coordinator.startFanOut.mock.calls[0][0];
      expect(arg.slots).toHaveLength(1);
      expect(arg.slots[0]).toMatchObject({ source: 'activation', isAutoResponse: true });
      // Parent's getChannelSettings call must have fired.
      expect(gatewayClient.getChannelSettings).toHaveBeenCalledTimes(2);
      expect(gatewayClient.getChannelSettings).toHaveBeenNthCalledWith(2, 'parent-channel-1');
    });

    it('does NOT fall back when the thread is explicitly deactivated', async () => {
      // Thread has a settings row but no activated personality — explicit
      // empty beats parent inheritance per the inherited contract.
      gatewayClient.getChannelSettings.mockResolvedValueOnce({
        hasSettings: true,
        settings: { personalitySlug: null, personalityName: null },
      });
      vi.mocked(getThreadParentId).mockReturnValue('parent-channel-1');

      await processor.process(buildMessage({ content: 'hi' }));

      // Only the thread was queried — parent never consulted.
      expect(gatewayClient.getChannelSettings).toHaveBeenCalledTimes(1);
      // No slots → coordinator not invoked.
      expect(coordinator.startFanOut).not.toHaveBeenCalled();
    });
  });

  describe('Error resilience', () => {
    it('continues with reply + mentions when activation lookup throws', async () => {
      const alice = buildPersonality('Alice');
      const bob = buildPersonality('Bob');
      replyResolver.resolvePersonality.mockResolvedValue(alice);
      gatewayClient.getChannelSettings.mockRejectedValue(new Error('gateway 503'));
      vi.mocked(findPersonalityMentions).mockResolvedValue([{ personality: bob, startIndex: 0 }]);

      await processor.process(
        buildMessage({ reference: { messageId: 'ref-1' } as never, content: '@Bob hi' })
      );

      expect(coordinator.startFanOut).toHaveBeenCalledOnce();
      const arg = coordinator.startFanOut.mock.calls[0][0];
      expect(arg.slots.map((s: { personality: LoadedPersonality }) => s.personality.name)).toEqual([
        'Alice',
        'Bob',
      ]);
    });

    it('continues with reply + activation when mention parsing throws', async () => {
      const alice = buildPersonality('Alice');
      const ambient = buildPersonality('Ambient');
      replyResolver.resolvePersonality.mockResolvedValue(alice);
      gatewayClient.getChannelSettings.mockResolvedValue({
        hasSettings: true,
        settings: { personalitySlug: 'ambient', personalityName: 'Ambient' },
      });
      personalityService.loadPersonality.mockResolvedValue(ambient);
      vi.mocked(findPersonalityMentions).mockRejectedValue(new Error('db error'));

      await processor.process(
        buildMessage({ reference: { messageId: 'ref-1' } as never, content: '@Bob hi' })
      );

      expect(coordinator.startFanOut).toHaveBeenCalledOnce();
      const arg = coordinator.startFanOut.mock.calls[0][0];
      expect(arg.slots.map((s: { personality: LoadedPersonality }) => s.personality.name)).toEqual([
        'Alice',
        'Ambient',
      ]);
    });
  });

  describe('Dedupe', () => {
    it('drops a mention that duplicates the reply target', async () => {
      const alice = buildPersonality('Alice');
      replyResolver.resolvePersonality.mockResolvedValue(alice);
      vi.mocked(findPersonalityMentions).mockResolvedValue([
        { personality: alice, startIndex: 0 }, // same personality as reply
        { personality: buildPersonality('Bob'), startIndex: 7 },
      ]);

      await processor.process(
        buildMessage({ reference: { messageId: 'r' } as never, content: '@Alice @Bob hi' })
      );

      const arg = coordinator.startFanOut.mock.calls[0][0];
      expect(arg.slots.map((s: { personality: LoadedPersonality }) => s.personality.name)).toEqual([
        'Alice',
        'Bob',
      ]);
    });
  });
});
