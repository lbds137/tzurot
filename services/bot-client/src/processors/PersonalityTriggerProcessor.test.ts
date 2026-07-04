/**
 * Tests for PersonalityTriggerProcessor — the consolidated entry point that
 * resolves reply + activation + mentions and hands the slot list to the
 * MultiTagCoordinator.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelType, type Message } from 'discord.js';
import { MULTI_TAG } from '@tzurot/common-types/constants/message';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { InfraError, GatewayClientError } from '@tzurot/clients';
import { PersonalityTriggerProcessor } from './PersonalityTriggerProcessor.js';

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => ({ BOT_MENTION_CHAR: '@' }),
  };
});

vi.mock('@tzurot/common-types/types/discord-types', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/types/discord-types')>(
    '@tzurot/common-types/types/discord-types'
  );
  return {
    ...actual,
    isTypingChannel: (channel: { type?: number }) =>
      channel.type === ChannelType.GuildText || channel.type === ChannelType.DM,
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
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

vi.mock('../utils/gatewayServiceCalls.js', () => ({
  getChannelSettingsCached: vi.fn(),
}));

import { findPersonalityMentions } from '../utils/personalityMentionParser.js';
import { isForwardedMessage } from '../utils/forwardedMessageUtils.js';
import { getThreadParentId } from '../utils/discordChannelTypes.js';
import { getChannelSettingsCached } from '../utils/gatewayServiceCalls.js';

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
  let personalityService: {
    loadPersonality: ReturnType<typeof vi.fn>;
    loadPersonalityStrict: ReturnType<typeof vi.fn>;
  };
  let replyResolver: { resolvePersonality: ReturnType<typeof vi.fn> };
  let coordinator: { startFanOut: ReturnType<typeof vi.fn> };
  let processor: PersonalityTriggerProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    personalityService = { loadPersonality: vi.fn(), loadPersonalityStrict: vi.fn() };
    // PTP's activated-channel resolution uses loadPersonalityStrict; mirror
    // loadPersonality so each test's mockResolvedValue applies to both.
    personalityService.loadPersonalityStrict.mockImplementation((...args: unknown[]) =>
      (personalityService.loadPersonality as (...a: unknown[]) => unknown)(...args)
    );
    replyResolver = { resolvePersonality: vi.fn().mockResolvedValue(null) };
    vi.mocked(getChannelSettingsCached).mockResolvedValue({
      hasSettings: false,
    } as Awaited<ReturnType<typeof getChannelSettingsCached>>);
    coordinator = { startFanOut: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(findPersonalityMentions).mockResolvedValue([]);
    vi.mocked(isForwardedMessage).mockReturnValue(false);
    processor = new PersonalityTriggerProcessor({
      personalityService: personalityService as never,
      replyResolver: replyResolver as never,
      coordinator: coordinator as never,
    });
  });

  describe('Pass-through cases', () => {
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

    it('flags truncated=true when more unique mentions than MAX_TAGS', async () => {
      // MAX_TAGS = 5. Six unique mentions → 5 slots delivered + truncated:true.
      // The coordinator then surfaces a user-visible notice after the burst.
      const personalities = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank'].map(buildPersonality);
      vi.mocked(findPersonalityMentions).mockResolvedValue(
        personalities.map((p, i) => ({ personality: p, startIndex: i * 7 }))
      );

      await processor.process(buildMessage({ content: '@Alice @Bob @Carol @Dave @Eve @Frank hi' }));

      const arg = coordinator.startFanOut.mock.calls[0][0];
      expect(arg.slots).toHaveLength(MULTI_TAG.MAX_TAGS);
      expect(arg.truncated).toBe(true);
    });

    it('flags truncated=false when mentions fit exactly at MAX_TAGS', async () => {
      const personalities = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve'].map(buildPersonality);
      vi.mocked(findPersonalityMentions).mockResolvedValue(
        personalities.map((p, i) => ({ personality: p, startIndex: i * 7 }))
      );

      await processor.process(buildMessage({ content: '@Alice @Bob @Carol @Dave @Eve hi' }));

      const arg = coordinator.startFanOut.mock.calls[0][0];
      expect(arg.slots).toHaveLength(MULTI_TAG.MAX_TAGS);
      expect(arg.truncated).toBe(false);
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
      vi.mocked(getChannelSettingsCached).mockResolvedValue({
        hasSettings: true,
        settings: { personalitySlug: 'ambient', personalityName: 'Ambient' },
      } as Awaited<ReturnType<typeof getChannelSettingsCached>>);
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

    it('swallows an infra failure silently (resilience catch, NOT the private-character notice)', async () => {
      // Behaviour change: an infra failure loading the activated personality
      // previously returned null → the "private character" notice. Now it THROWS
      // → resolveActivatedPersonality's resilience catch → no slot, no notice.
      vi.mocked(getChannelSettingsCached).mockResolvedValue({
        hasSettings: true,
        settings: { personalitySlug: 'ambient', personalityName: 'Ambient' },
      } as Awaited<ReturnType<typeof getChannelSettingsCached>>);
      personalityService.loadPersonalityStrict.mockRejectedValueOnce(
        new InfraError({ ok: false, kind: 'network', status: 0, error: 'boom' })
      );
      vi.mocked(findPersonalityMentions).mockResolvedValue([]);

      const message = buildMessage({ content: 'just chatting' });
      const result = await processor.process(message);

      // No slots → processor declines (chain continues), and crucially:
      expect(result).toBe(false);
      expect(coordinator.startFanOut).not.toHaveBeenCalled();
      // The private-character notice must NOT fire on an infra failure.
      expect(message.reply).not.toHaveBeenCalled();
    });

    it('swallows a GatewayClientError (non-404 4xx, e.g. 403) silently too — same resilience path', async () => {
      // A non-404 4xx is also a thrown failure, not a genuine miss — it must reach
      // the resilience catch (no slot, no notice), same as the InfraError case.
      vi.mocked(getChannelSettingsCached).mockResolvedValue({
        hasSettings: true,
        settings: { personalitySlug: 'ambient', personalityName: 'Ambient' },
      } as Awaited<ReturnType<typeof getChannelSettingsCached>>);
      personalityService.loadPersonalityStrict.mockRejectedValueOnce(
        new GatewayClientError({ ok: false, kind: 'http', status: 403, error: 'forbidden' })
      );
      vi.mocked(findPersonalityMentions).mockResolvedValue([]);

      const message = buildMessage({ content: 'just chatting' });
      const result = await processor.process(message);

      expect(result).toBe(false);
      expect(coordinator.startFanOut).not.toHaveBeenCalled();
      expect(message.reply).not.toHaveBeenCalled();
    });

    it('still shows the private-character notice on a GENUINE miss (200 null, not infra)', async () => {
      // The inverse of the test above: a genuine null (personality deleted /
      // access revoked) must STILL reach the private-character notice path.
      vi.mocked(getChannelSettingsCached).mockResolvedValue({
        hasSettings: true,
        settings: { personalitySlug: 'ambient', personalityName: 'Ambient' },
      } as Awaited<ReturnType<typeof getChannelSettingsCached>>);
      personalityService.loadPersonalityStrict.mockResolvedValue(null);
      vi.mocked(findPersonalityMentions).mockResolvedValue([]);

      const message = buildMessage({ content: 'just chatting' });
      const result = await processor.process(message);

      expect(result).toBe(false);
      expect(coordinator.startFanOut).not.toHaveBeenCalled();
      expect(message.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('private character') })
      );
    });

    it('dedupes when activation and mention resolve to the same personality (first occurrence wins)', async () => {
      // If a channel is activated for personality A, and the user @mentions
      // A in the same message, we should produce ONE slot, not two. The
      // first occurrence wins: activation (slot precedence 1) gets the
      // slot, the mention is dropped. SlotResolver's unit tests cover the
      // dedup logic; this is the integration check that the trigger
      // processor wires the inputs correctly.
      const alice = buildPersonality('Alice');
      vi.mocked(getChannelSettingsCached).mockResolvedValue({
        hasSettings: true,
        settings: { personalitySlug: 'alice', personalityName: 'Alice' },
      } as Awaited<ReturnType<typeof getChannelSettingsCached>>);
      personalityService.loadPersonality.mockResolvedValue(alice);
      vi.mocked(findPersonalityMentions).mockResolvedValue([{ personality: alice, startIndex: 0 }]);

      await processor.process(buildMessage({ content: '@Alice hi' }));

      const arg = coordinator.startFanOut.mock.calls[0][0];
      expect(arg.slots).toHaveLength(1);
      expect(arg.slots[0]).toMatchObject({
        personality: alice,
        source: 'activation',
        isAutoResponse: true,
      });
      // Truncation flag must NOT trip — this is dedup, not cap-driven drop.
      expect(arg.truncated).toBe(false);
    });

    it('does not include activated personality in DM channels', async () => {
      // DM channels have no guild → activation lookup is skipped.
      const alice = buildPersonality('Alice');
      vi.mocked(getChannelSettingsCached).mockResolvedValue({
        hasSettings: true,
        settings: { personalitySlug: 'ambient', personalityName: 'Ambient' },
      } as Awaited<ReturnType<typeof getChannelSettingsCached>>);
      vi.mocked(findPersonalityMentions).mockResolvedValue([{ personality: alice, startIndex: 0 }]);

      await processor.process(
        buildMessage({
          guildId: null,
          channel: { id: 'dm-1', type: ChannelType.DM } as Message['channel'],
        })
      );

      // The processor shouldn't have called getChannelSettings at all
      expect(vi.mocked(getChannelSettingsCached)).not.toHaveBeenCalled();
      const arg = coordinator.startFanOut.mock.calls[0][0];
      expect(arg.slots).toHaveLength(1);
      expect(arg.slots[0].source).toBe('mention');
    });

    it('sends notice + omits slot when activated personality is inaccessible', async () => {
      vi.mocked(getChannelSettingsCached).mockResolvedValue({
        hasSettings: true,
        settings: { personalitySlug: 'private', personalityName: 'Private' },
      } as Awaited<ReturnType<typeof getChannelSettingsCached>>);
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

  describe('Forwarded messages', () => {
    it('lets activation slot fire on forwarded messages (image-only screenshots etc.)', async () => {
      // Invariant: in an activated channel, the activation slot fires for
      // forwarded messages regardless of text content. The forwarder's intent
      // is to share something into the channel; the activated personality
      // owns the response policy.
      vi.mocked(isForwardedMessage).mockReturnValue(true);
      const ambient = buildPersonality('Ambient');
      vi.mocked(getChannelSettingsCached).mockResolvedValue({
        hasSettings: true,
        settings: { personalitySlug: 'ambient', personalityName: 'Ambient' },
      } as Awaited<ReturnType<typeof getChannelSettingsCached>>);
      personalityService.loadPersonality.mockResolvedValue(ambient);

      const result = await processor.process(buildMessage({ content: '' }));

      expect(result).toBe(true);
      expect(coordinator.startFanOut).toHaveBeenCalledOnce();
      const arg = coordinator.startFanOut.mock.calls[0][0];
      expect(arg.slots).toHaveLength(1);
      expect(arg.slots[0]).toMatchObject({
        personality: ambient,
        source: 'activation',
        isAutoResponse: true,
      });
    });

    it('skips reply resolution on forwarded messages even if message.reference is set', async () => {
      // A forwarded message can technically carry a `reference` field, but
      // the forwarder isn't replying to the bot — the field tracks the
      // origin of the forward, not a webhook-reply intent. Skip resolution
      // to avoid spurious slot population.
      vi.mocked(isForwardedMessage).mockReturnValue(true);
      const ambient = buildPersonality('Ambient');
      vi.mocked(getChannelSettingsCached).mockResolvedValue({
        hasSettings: true,
        settings: { personalitySlug: 'ambient', personalityName: 'Ambient' },
      } as Awaited<ReturnType<typeof getChannelSettingsCached>>);
      personalityService.loadPersonality.mockResolvedValue(ambient);

      await processor.process(buildMessage({ reference: { messageId: 'origin-msg' } }));

      expect(replyResolver.resolvePersonality).not.toHaveBeenCalled();
      expect(coordinator.startFanOut).toHaveBeenCalledOnce();
    });

    it('skips inline mention resolution on forwarded messages — text content is the original author, not the forwarder', async () => {
      vi.mocked(isForwardedMessage).mockReturnValue(true);
      const alice = buildPersonality('Alice');
      vi.mocked(findPersonalityMentions).mockResolvedValue([{ personality: alice, startIndex: 0 }]);
      // No activation either — the forwarded message should fall through to
      // the next processor since neither activation nor mention applies.
      vi.mocked(getChannelSettingsCached).mockResolvedValue({ hasSettings: false } as Awaited<
        ReturnType<typeof getChannelSettingsCached>
      >);

      const result = await processor.process(buildMessage({ content: '@Alice forwarded' }));

      expect(findPersonalityMentions).not.toHaveBeenCalled();
      expect(result).toBe(false);
      expect(coordinator.startFanOut).not.toHaveBeenCalled();
    });
  });

  describe('Thread-channel activation inheritance', () => {
    it('falls back to parent channel when the thread has NO settings row', async () => {
      const parentAmbient = buildPersonality('ParentAmbient');
      // Thread has no settings — should fall back to parent
      vi.mocked(getChannelSettingsCached)
        .mockResolvedValueOnce({ hasSettings: false } as Awaited<
          ReturnType<typeof getChannelSettingsCached>
        >) // thread
        .mockResolvedValueOnce({
          // parent
          hasSettings: true,
          settings: { personalitySlug: 'parentambient', personalityName: 'ParentAmbient' },
        } as Awaited<ReturnType<typeof getChannelSettingsCached>>);
      personalityService.loadPersonality.mockResolvedValue(parentAmbient);
      vi.mocked(getThreadParentId).mockReturnValueOnce('parent-channel-1');

      await processor.process(buildMessage({ content: 'hi' }));

      expect(coordinator.startFanOut).toHaveBeenCalledOnce();
      const arg = coordinator.startFanOut.mock.calls[0][0];
      expect(arg.slots).toHaveLength(1);
      expect(arg.slots[0]).toMatchObject({ source: 'activation', isAutoResponse: true });
      // Parent's getChannelSettings call must have fired.
      expect(vi.mocked(getChannelSettingsCached)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(getChannelSettingsCached)).toHaveBeenNthCalledWith(2, 'parent-channel-1');
    });

    it('does NOT fall back when the thread is explicitly deactivated', async () => {
      // Thread has a settings row but no activated personality — explicit
      // empty beats parent inheritance per the inherited contract.
      vi.mocked(getChannelSettingsCached).mockResolvedValueOnce({
        hasSettings: true,
        settings: { personalitySlug: null, personalityName: null },
      } as Awaited<ReturnType<typeof getChannelSettingsCached>>);
      vi.mocked(getThreadParentId).mockReturnValue('parent-channel-1');

      await processor.process(buildMessage({ content: 'hi' }));

      // Only the thread was queried — parent never consulted.
      expect(vi.mocked(getChannelSettingsCached)).toHaveBeenCalledTimes(1);
      // No slots → coordinator not invoked.
      expect(coordinator.startFanOut).not.toHaveBeenCalled();
    });
  });

  describe('Error resilience', () => {
    it('continues with reply + mentions when activation lookup throws', async () => {
      const alice = buildPersonality('Alice');
      const bob = buildPersonality('Bob');
      replyResolver.resolvePersonality.mockResolvedValue(alice);
      vi.mocked(getChannelSettingsCached).mockRejectedValue(new Error('gateway 503'));
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
      vi.mocked(getChannelSettingsCached).mockResolvedValue({
        hasSettings: true,
        settings: { personalitySlug: 'ambient', personalityName: 'Ambient' },
      } as Awaited<ReturnType<typeof getChannelSettingsCached>>);
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
