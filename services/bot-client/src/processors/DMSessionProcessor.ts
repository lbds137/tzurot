/**
 * DM Session Processor
 *
 * Handles "sticky" DM personality sessions. Once a user @mentions a personality in DMs,
 * subsequent messages go to that personality without needing to mention again.
 * Users can switch by mentioning a different personality.
 *
 * This processor sits AFTER PersonalityTriggerProcessor in the chain:
 * - PersonalityTriggerProcessor handles tagged messages (reply/activation/@mentions)
 *   and updates the active DM session via channel_settings.
 * - DMSessionProcessor handles bare DM messages, routing them to the active
 *   session character. Reads channel_settings first; falls back to history
 *   scan + lazy backfill if no settings row exists yet.
 */

import type { Message, DMChannel } from 'discord.js';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { IMessageProcessor } from './IMessageProcessor.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import { InfraError, GatewayClientError } from '@tzurot/clients';
import {
  getChannelSettingsCached,
  setDmSessionPersonality,
  lookupPersonalityFromMessage,
} from '../utils/gatewayServiceCalls.js';
import { type PersonalityMessageHandler } from '../services/PersonalityMessageHandler.js';
import { VoiceMessageProcessor } from './VoiceMessageProcessor.js';
import {
  isDMChannel,
  sendNsfwVerificationMessage,
  checkNsfwVerification,
  NSFW_VERIFICATION_CHECK_FAILED_MESSAGE,
} from '../utils/nsfwVerification.js';
import { clientsForUser } from '../utils/gatewayClients.js';
import { getEffectiveContent } from '../utils/messageTypeUtils.js';
import type { MultiTagPersistence } from '../services/MultiTagPersistence.js';

const logger = createLogger('DMSessionProcessor');

/**
 * Regex to match personality prefix in bot messages: **DisplayName:**
 * This pattern is used by webhook messages and identifies which personality sent a message.
 * Ephemeral messages (NSFW verification, help) don't have this prefix.
 */
const DM_PERSONALITY_PREFIX_REGEX = /^\*\*(.+?):\*\*/;

/**
 * How many recent messages to scan when looking for active personality
 */
const DM_MESSAGE_SCAN_LIMIT = 50;

/**
 * How long the help message stays before self-destructing (ms)
 */
const HELP_MESSAGE_DELETE_DELAY = 30_000;

export class DMSessionProcessor implements IMessageProcessor {
  constructor(
    private readonly personalityService: IPersonalityLoader,
    private readonly personalityHandler: PersonalityMessageHandler,
    private readonly multiTagPersistence: MultiTagPersistence
  ) {}

  async process(message: Message): Promise<boolean> {
    // 1. Only process DM channels
    if (!isDMChannel(message.channel)) {
      return false;
    }

    const userId = message.author.id;
    const botId = message.client.user?.id;

    logger.debug({ userId }, 'Processing DM message');

    // 2. Check NSFW verification first (higher priority than help message).
    // Tri-state: verified / unverified / check-failed. Fail-closed on
    // check-failed with a distinct "try again" message so a transient gateway
    // blip doesn't re-onboard previously-verified users.
    const check = await checkNsfwVerification(clientsForUser(message.author).userClient);
    if (check.kind === 'error') {
      logger.warn({ userId, error: check.error }, 'NSFW check failed — surfacing retry message');
      try {
        await message.reply(NSFW_VERIFICATION_CHECK_FAILED_MESSAGE);
      } catch (replyError) {
        logger.warn(
          { err: replyError, messageId: message.id },
          'Failed to send NSFW check-failed message'
        );
      }
      return true; // Consume message
    }
    if (!check.value.nsfwVerified) {
      logger.info({ userId }, 'DM blocked - user not NSFW verified');
      await sendNsfwVerificationMessage(message);
      return true; // Consume message
    }

    // 3. Find active personality — channel_settings first, lazy-backfill from
    // history scan if no settings row yet. The multi-tag coordinator writes
    // the active personality after every DM fan-out, so for any DM that has
    // ever produced a multi-tag response, this hits the cached settings path.
    //
    // Note: explicit @-mentions / replies / activations are routed by
    // PersonalityTriggerProcessor earlier in the chain. By the time this
    // processor runs, the message is bare (no trigger). The previous "detect
    // mention and defer" branch here was dead code under the new chain order.
    const resolved = await this.resolveActiveDmPersonality(message, botId);

    if (resolved === null || resolved.personalityId.length === 0) {
      // No active session - send self-destructing help message
      logger.debug({ userId }, 'No active session found');
      await this.sendHelpMessage(message);
      return true; // Consume message (don't continue chain)
    }

    // 4. Load personality with access control. The backfill path may have
    // already loaded it (uses the same userId as access scope) — reuse the
    // cached object in that case to avoid a redundant DB roundtrip. The
    // fast-path returns only the ID (cheap to re-load via TTLCache).
    // STRICT: the session IS active, so a gateway FAILURE must not read as
    // "no active conversation". loadPersonalityStrict throws on infra/4xx →
    // surface "try again"; `null` means the persona was genuinely deleted /
    // access revoked → the help path below.
    let personality: LoadedPersonality | null;
    try {
      personality =
        resolved.personality ??
        (await this.personalityService.loadPersonalityStrict(resolved.personalityId, userId));
    } catch (error) {
      if (error instanceof InfraError || error instanceof GatewayClientError) {
        logger.warn(
          { err: error, userId, personalityId: resolved.personalityId },
          'Persona load failed for an active DM session; surfacing retry'
        );
        await message.reply(
          "⏳ Couldn't reach the server just now — please try again in a moment."
        );
        return true;
      }
      throw error;
    }

    if (!personality) {
      // Personality deleted or access revoked - send help
      logger.debug(
        { userId, personalityId: resolved.personalityId },
        'Personality not accessible, showing help'
      );
      await this.sendHelpMessage(message);
      return true;
    }

    // 5. Handle the message via existing infrastructure
    const voiceTranscript = VoiceMessageProcessor.getVoiceTranscript(message);
    const content = voiceTranscript ?? getEffectiveContent(message);

    logger.info(
      { userId, personalityName: personality.displayName },
      'Routing DM to active personality session'
    );

    await this.personalityHandler.handleMessage(message, personality, content, {
      isAutoResponse: true,
    });

    return true; // Handled
  }

  /**
   * Resolve the active DM personality with cache-first lookup + lazy backfill.
   *
   * Priority order:
   *   1. channel_settings (single Redis-cached lookup via getChannelSettingsCached) —
   *      this is the steady-state path, written by MultiTagCoordinator
   *      after every multi-tag DM fan-out.
   *   2. History scan (existing logic) — only when no settings row exists
   *      yet. On success, write the discovered personality slug to
   *      channel_settings so subsequent messages take the fast path.
   *
   * **Return shape**: `{ personalityId, personality }` lets the caller reuse
   * an already-loaded personality from the backfill path (avoids a second
   * DB roundtrip). The fast-path returns `personality: null` because the
   * channel_settings hit doesn't have a personality object handy and a
   * fresh cache-backed load is cheap. `null` (top-level) means no session.
   */
  private async resolveActiveDmPersonality(
    message: Message,
    botId: string | undefined
  ): Promise<{ personalityId: string; personality: LoadedPersonality | null } | null> {
    const channelId = message.channelId;

    const channelSettings = await getChannelSettingsCached(channelId);
    if (
      channelSettings?.hasSettings === true &&
      channelSettings.settings?.activatedPersonalityId !== undefined &&
      channelSettings.settings.activatedPersonalityId !== null
    ) {
      return { personalityId: channelSettings.settings.activatedPersonalityId, personality: null };
    }

    // History scan is expensive (Discord API fetch of 50 messages). The
    // backfill-tried sentinel prevents repeating the scan for DM channels
    // we've already attempted to backfill and found nothing. TTL on the
    // sentinel ensures a session that materializes later eventually gets
    // discovered without manual cache clear.
    if (await this.multiTagPersistence.wasDMBackfillTried(channelId)) {
      return null;
    }

    // Fallback: history scan (lazy backfill).
    const personalityId = await this.findActivePersonality(message.channel as DMChannel, botId);
    if (personalityId !== null && personalityId.length > 0) {
      // Look up slug for the backfill write. Loading the personality also
      // validates access; if the user can't see it, we don't backfill. The
      // loaded object is also returned to the caller so it doesn't have to
      // re-load it for its own access gate.
      const personality = await this.personalityService.loadPersonality(
        personalityId,
        message.author.id
      );
      if (personality !== null) {
        // Fire-and-forget — best-effort, doesn't block the response.
        // Also clear the backfill-tried sentinel (this scan just succeeded
        // so any prior negative-cache marker should not survive).
        void setDmSessionPersonality(channelId, personality.slug);
        void this.multiTagPersistence.clearDMBackfillTried(channelId);
      }
      return { personalityId, personality };
    }

    // Scan came back empty. Record the attempt so the next bare DM doesn't
    // re-scan; the sentinel TTL caps how long this negative cache lasts.
    // Fire-and-forget with explicit catch so a Redis blip doesn't silently
    // swallow the sentinel write (next bare DM would otherwise re-scan).
    void this.multiTagPersistence
      .markDMBackfillTried(channelId)
      .catch(err =>
        logger.warn(
          { err, channelId },
          'Failed to set DM backfill sentinel — next bare DM will re-scan'
        )
      );
    return null;
  }

  /**
   * Find the active personality by looking at recent DM messages.
   * Finds most recent bot message with **DisplayName:** prefix and looks up
   * the personality via conversation history. Used as the lazy-backfill
   * fallback when channel_settings has no DM-session row yet.
   */
  private async findActivePersonality(
    channel: DMChannel,
    botId: string | undefined
  ): Promise<string | null> {
    if (botId === undefined || botId.length === 0) {
      logger.warn('Bot ID not available');
      return null;
    }

    try {
      // Fetch recent messages
      const messages = await channel.messages.fetch({ limit: DM_MESSAGE_SCAN_LIMIT });

      // Find most recent bot message with personality prefix
      for (const msg of messages.values()) {
        if (msg.author.id !== botId) {
          continue;
        }

        const match = DM_PERSONALITY_PREFIX_REGEX.exec(msg.content);
        if (match === null) {
          continue; // Skip ephemeral messages (no prefix)
        }

        // Look up this message in conversation history
        const historyEntry = await lookupPersonalityFromMessage(msg.id);
        if (historyEntry?.personalityId !== undefined && historyEntry.personalityId.length > 0) {
          logger.debug(
            { messageId: msg.id, personalityId: historyEntry.personalityId },
            'Found active personality from conversation history'
          );
          return historyEntry.personalityId;
        }

        // If not in DB (very old message), we could try display name lookup as fallback
        // but for now, just continue to the next message
        logger.debug(
          { messageId: msg.id, displayName: match[1] },
          'Message not found in conversation history, trying next'
        );
      }

      return null; // No personality messages found
    } catch (error) {
      logger.error({ err: error }, 'Error fetching DM messages');
      return null;
    }
  }

  /**
   * Send a self-destructing help message explaining how to start a conversation
   */
  private async sendHelpMessage(message: Message): Promise<void> {
    try {
      const helpMsg = await message.reply({
        content: `**No active conversation**

To start chatting, mention a character:
\`@character_name hello\`

Or reply to any of my previous messages.`,
      });

      // Delete help message after delay
      setTimeout(() => {
        helpMsg.delete().catch(() => {
          // Ignore deletion failures (message may already be deleted)
        });
      }, HELP_MESSAGE_DELETE_DELAY);
    } catch (error) {
      // Ignore - user may have DMs disabled or other Discord API issues
      logger.debug({ err: error }, 'Failed to send help message');
    }
  }
}
