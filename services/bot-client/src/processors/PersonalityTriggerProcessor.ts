/**
 * Personality Trigger Processor
 *
 * Consolidates the three trigger sources that used to live in separate
 * processors (Reply / Mention / ActivatedChannel) into one decision point.
 * For every Discord message, this processor:
 *
 *   1. Resolves the reply-to-character (if the message is a reply to a webhook).
 *   2. Resolves the activated channel personality (guild channels only).
 *   3. Resolves inline `@`-mentioned personalities (textually, deduped, capped).
 *   4. Hands the ordered slot list to MultiTagCoordinator for fan-out.
 *
 * DMs: bare messages with no mention/reply fall through to DMSessionProcessor
 * (which keeps its existing history-scan + session-dispatch path). Multi-tag
 * works in DMs the same way as guild channels — the rightmost mention will
 * naturally become the new active session via slot-ordered delivery + the
 * existing history-scan logic.
 *
 * Slot ordering rules:
 *   slot 0 = reply (explicit user intent, `isAutoResponse: false`)
 *   slot 1 = activation (ambient channel default, `isAutoResponse: true`)
 *   slots 2..N = inline mentions (textual order, `isAutoResponse: false`)
 */

import type { Message } from 'discord.js';
import { getConfig } from '@tzurot/common-types/config/config';
import { isTypingChannel } from '@tzurot/common-types/types/discord-types';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { IMessageProcessor } from './IMessageProcessor.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import type { ReplyResolutionService } from '../services/ReplyResolutionService.js';
import { getChannelSettingsCached } from '../utils/gatewayServiceCalls.js';
import type { MultiTagCoordinator } from '../services/MultiTagCoordinator.js';
import { resolveSlots } from '../services/SlotResolver.js';
import { findPersonalityMentions } from '../utils/personalityMentionParser.js';
import { VoiceMessageProcessor } from './VoiceMessageProcessor.js';
import { isForwardedMessage } from '../utils/forwardedMessageUtils.js';
import { getEffectiveContent } from '../utils/messageTypeUtils.js';
import { getThreadParentId } from '../utils/discordChannelTypes.js';
import { shouldNotifyUser } from './notificationCache.js';

const logger = createLogger('PersonalityTriggerProcessor');

export interface PersonalityTriggerProcessorDeps {
  personalityService: IPersonalityLoader;
  replyResolver: ReplyResolutionService;
  coordinator: MultiTagCoordinator;
}

export class PersonalityTriggerProcessor implements IMessageProcessor {
  constructor(private readonly deps: PersonalityTriggerProcessorDeps) {}

  async process(message: Message): Promise<boolean> {
    if (!isTypingChannel(message.channel)) {
      // Coordinator + chat manager need a TypingChannel for delivery; bail
      // out for channel types we don't support (announcement guild forum,
      // voice channels with text, etc.).
      return false;
    }

    const userId = message.author.id;
    const channel = message.channel;
    // Forwards: activation fires (forwarder posted into activated channel),
    // but reply/mention resolution is skipped — forwards carry no webhook-
    // reply relationship and text content was authored by the *original*
    // sender.
    const forwarded = isForwardedMessage(message);

    // Resolve the three trigger sources in parallel — they don't depend on
    // each other and each may produce 0..1 personalities.
    //
    // Cold-cache caveat: this may load the same personality up to 3x when
    // reply target + activation + mention all resolve to the same character.
    // The routing loader's cache makes this cheap in steady state; SlotResolver's
    // `resolveSlots` dedupes by personality.id downstream so the duplicate
    // resolution doesn't propagate. The duplicated cold-cache fetch is an
    // acceptable cost for keeping the resolvers independent.
    const [replyPersonality, activatedPersonality, mentionedPersonalities] = await Promise.all([
      forwarded ? Promise.resolve(null) : this.resolveReplyPersonality(message, userId),
      this.resolveActivatedPersonality(message, userId),
      forwarded
        ? Promise.resolve<LoadedPersonality[]>([])
        : this.resolveMentionedPersonalities(message, userId),
    ]);

    const slots = resolveSlots({
      replyPersonality,
      activatedPersonality,
      mentionedPersonalities,
    });

    if (slots.length === 0) {
      return false; // Nothing for this processor to do; let chain continue.
    }

    // Did the cap drop any tagged personalities? Compare unique candidate
    // count to delivered slot count. Dedup-driven shrinkage (same personality
    // mentioned twice) doesn't count as truncation — only the cap does.
    const uniqueCandidates = new Set<string>();
    if (replyPersonality !== null) {
      uniqueCandidates.add(replyPersonality.id);
    }
    if (activatedPersonality !== null) {
      uniqueCandidates.add(activatedPersonality.id);
    }
    for (const m of mentionedPersonalities) {
      uniqueCandidates.add(m.id);
    }
    const truncated = uniqueCandidates.size > slots.length;

    const voiceTranscript = VoiceMessageProcessor.getVoiceTranscript(message);
    const content = voiceTranscript ?? getEffectiveContent(message);

    logger.info(
      {
        messageId: message.id,
        slotCount: slots.length,
        candidateCount: uniqueCandidates.size,
        truncated,
        sources: slots.map(s => s.source),
        personalityIds: slots.map(s => s.personality.id),
      },
      'Multi-tag trigger resolved, handing off to coordinator'
    );

    await this.deps.coordinator.startFanOut({
      message,
      channel,
      slots,
      content,
      truncated,
    });

    return true; // Stop chain — coordinator owns delivery from here.
  }

  /**
   * Resolve the personality this message is a reply to (if any).
   * Returns null when the message isn't a reply, doesn't reference a
   * personality webhook, or the user lacks access.
   */
  private async resolveReplyPersonality(
    message: Message,
    userId: string
  ): Promise<LoadedPersonality | null> {
    if (!message.reference) {
      return null;
    }
    try {
      return await this.deps.replyResolver.resolvePersonality(message, userId);
    } catch (err) {
      logger.warn({ err, messageId: message.id, userId }, 'Reply resolution failed');
      return null;
    }
  }

  /**
   * Resolve the activated-channel personality (guild channels only). Inherits
   * thread→parent fallback behavior from the old ActivatedChannelProcessor.
   * On access denial for a private activation, sends the same rate-limited
   * notice the old processor sent.
   */
  private async resolveActivatedPersonality(
    message: Message,
    userId: string
  ): Promise<LoadedPersonality | null> {
    // Activation is a guild-channel concept — DMs don't have channel-level
    // activation in v1.
    if (message.guildId === null) {
      return null;
    }
    try {
      return await this.resolveActivatedPersonalityInner(message, userId);
    } catch (err) {
      // Resilience: a transient gateway error here must not poison the
      // sibling resolvers (reply / mentions) in the Promise.all. The
      // old per-processor design fell through to the next processor on
      // failure; this catch preserves that behavior at the unified-processor
      // level.
      logger.warn(
        { err, messageId: message.id, userId },
        'Activated-channel resolution failed; continuing without activation slot'
      );
      return null;
    }
  }

  private async resolveActivatedPersonalityInner(
    message: Message,
    userId: string
  ): Promise<LoadedPersonality | null> {
    const channelId = message.channelId;

    let channelSettings = await getChannelSettingsCached(channelId);

    // Fall back to parent channel only when the thread has NO settings row
    // at all. A thread with an explicit settings row + null personality
    // means "explicitly deactivated" — respect that over parent inheritance.
    // (Inherited from the old ActivatedChannelProcessor's documented behavior.)
    if (channelSettings?.hasSettings !== true) {
      const parentId = getThreadParentId(message.channel);
      if (parentId !== null) {
        channelSettings = await getChannelSettingsCached(parentId);
      }
    }

    if (
      channelSettings?.hasSettings !== true ||
      channelSettings.settings?.personalitySlug === undefined ||
      channelSettings.settings.personalitySlug === null
    ) {
      return null;
    }

    const { personalitySlug, personalityName } = channelSettings.settings;

    // STRICT: a gateway FAILURE throws → caught by resolveActivatedPersonality's
    // resilience catch → no activation slot (silent), NOT the "private character"
    // notice below. `null` means the activated persona genuinely isn't accessible
    // to this user (200 with personality:null) → the notice is correct.
    const personality = await this.deps.personalityService.loadPersonalityStrict(
      personalitySlug,
      userId
    );

    if (personality === null) {
      logger.debug(
        { channelId, personalitySlug, personalityName, userId },
        'Activated personality not accessible — skipping for this user'
      );
      // Rate-limited notice (matches old ActivatedChannelProcessor behavior).
      if (shouldNotifyUser(channelId, userId)) {
        await message
          .reply({
            content: `📍 This channel has **${personalityName}** activated, but it's a private character you don't have access to. You can still @mention other characters or ask the character owner for access.`,
            allowedMentions: { parse: [], repliedUser: false },
          })
          .catch(err =>
            logger.warn({ err, channelId, userId }, 'Failed to send private-personality notice')
          );
      }
      return null;
    }

    return personality;
  }

  /**
   * Resolve inline `@`-mention personalities, in textual order, deduped,
   * capped at the multi-tag MAX_TAGS. Returns just the personality objects;
   * the slot resolver applies dedupe-vs-reply/activation and final ordering.
   */
  private async resolveMentionedPersonalities(
    message: Message,
    userId: string
  ): Promise<LoadedPersonality[]> {
    try {
      const config = getConfig();
      const matches = await findPersonalityMentions(
        getEffectiveContent(message),
        config.BOT_MENTION_CHAR,
        this.deps.personalityService,
        userId
      );
      return matches.map(m => m.personality);
    } catch (err) {
      // Resilience: see resolveActivatedPersonality. A transient DB hiccup
      // during the batched personality lookup must not block reply /
      // activation paths.
      logger.warn(
        { err, messageId: message.id, userId },
        'Mention resolution failed; continuing without mention slots'
      );
      return [];
    }
  }
}
