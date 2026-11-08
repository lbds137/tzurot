/**
 * Late-result recovery
 *
 * Delivers the real result of a multi-tag slot that was already
 * synthetic-timed-out, as a personality follow-up. Extracted from
 * MessageHandler so that file stays within its size budget.
 */

import type { Client } from 'discord.js';
import { type LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  reportDeliveryFailure,
  reportQuotaFallbackRescue,
} from '../observability/ErrorChannelReporter.js';
import { buildResultMetadataPassthrough } from '../utils/resultMetadataPassthrough.js';
import { fetchTypingChannel } from '../utils/fetchTypingChannel.js';
import type { DiscordResponseSender } from '../services/DiscordResponseSender.js';
import type { MultiTagCoordinator } from '../services/MultiTagCoordinator.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import type { JobResultDisposition } from '../services/deliverJobResult.js';

/** Notice prepended to a late-recovered reply so the user knows why it's late. */
const LATE_RECOVERY_NOTICE = '-# ⏰ This reply took longer than expected to generate.\n\n';

const logger = createLogger('lateResultRecovery');

/** Collaborators `recoverLateResult` needs; the same instances MessageHandler holds. */
export interface LateResultRecoveryDeps {
  coordinator: Pick<MultiTagCoordinator, 'getSyntheticTimeout' | 'clearSyntheticTimeout'>;
  /** Loads personalities by slug (access-scoped). */
  personalityService: IPersonalityLoader;
  /** Discord client — re-fetches the channel for the follow-up. */
  client: Client;
  responseSender: DiscordResponseSender;
}

/**
 * Late-result recovery for multi-tag slots that were synthetic-timed-out.
 * Returns null if this jobId had no recovery marker (a genuinely unknown job
 * that the caller drops). On a marker hit it returns the disposition and
 * always clears the marker so it doesn't linger.
 *
 * This function never confirms delivery; only the caller does, when it sees
 * 'delivered'. 'delivered' means the follow-up send succeeded, or the late
 * result was failed/empty (the user already received the synthetic timeout
 * message, so there is nothing real to deliver). 'dropped' means a real
 * late reply was lost (personality unloadable, channel missing, or the send
 * threw), so the gateway row stays PENDING_DELIVERY as an honest unconfirmed
 * record. Nothing reclaims PENDING_DELIVERY rows (the ai-worker cleanup
 * deletes only DELIVERED ones), so this trades a small row leak for a
 * visible loss signal, the same trade the unknown-job drop makes.
 *
 * A successful result is re-sent as a personality follow-up (prefixed with
 * a "took longer than expected" notice).
 *
 * Note: the follow-up is NOT persisted to conversation history — the marker
 * deliberately carries minimal context (no personaId/userMessageTime) and
 * this is a rare >18-min-job edge case. The user sees the reply; it just
 * won't anchor a subsequent turn's memory. Acceptable for the recovery path.
 */
export async function recoverLateResult(
  deps: LateResultRecoveryDeps,
  jobId: string,
  result: LLMGenerationResult
): Promise<JobResultDisposition | null> {
  const ctx = await deps.coordinator.getSyntheticTimeout(jobId);
  if (ctx === null) {
    return null; // not a synthetic-timeout job — let the caller drop it
  }

  // From here we own the outcome and always clear the marker. Delivery
  // confirmation is NOT done here: the caller confirms only on 'delivered',
  // so a lossy branch below returns 'dropped' and leaves the row unconfirmed.
  // clearSyntheticTimeout is awaited so the recovery marker doesn't linger
  // if we crash right after the follow-up send but before its TTL elapses.
  const finalize = async (): Promise<void> => {
    await deps.coordinator.clearSyntheticTimeout(jobId);
  };

  // Failed/empty late result: the user already saw the synthetic timeout
  // error — don't send a second (error) message. Just clean up.
  if (
    result.success === false ||
    typeof result.content !== 'string' ||
    result.content.length === 0
  ) {
    logger.info(
      { jobId },
      'Late result for synthetic-timed-out job was unusable — clearing marker, no follow-up'
    );
    await finalize();
    return 'delivered';
  }

  const personality = await deps.personalityService.loadPersonality(
    ctx.personalitySlug,
    ctx.recipientUserId
  );
  if (personality === null) {
    logger.error(
      { jobId, slug: ctx.personalitySlug, reason: 'personality-unloadable' },
      'Late recovery: personality no longer loadable - dropping, NOT confirming'
    );
    await finalize();
    return 'dropped';
  }

  const channel = await fetchTypingChannel(deps.client, ctx.channelId);
  if (channel === null) {
    logger.error(
      { jobId, channelId: ctx.channelId, reason: 'channel-missing' },
      'Late recovery: channel missing or not a typing channel - dropping, NOT confirming'
    );
    await finalize();
    return 'dropped';
  }

  reportQuotaFallbackRescue(result, personality.name);

  try {
    await deps.responseSender.sendResponse({
      content: LATE_RECOVERY_NOTICE + result.content,
      personality,
      channel,
      guildId: ctx.guildId,
      clientId: ctx.clientId,
      recipientUserId: ctx.recipientUserId,
      isAutoResponse: ctx.isAutoResponse,
      ...buildResultMetadataPassthrough(result),
    });
    logger.info(
      { jobId, personalityId: personality.id },
      'Late result recovered and delivered as a follow-up'
    );
  } catch (err) {
    logger.error(
      { err, jobId, reason: 'send-failed' },
      'Late recovery: follow-up send failed - dropping, NOT confirming'
    );
    // Send failure on an already-successful late result — the same
    // always-pageable class as the delivery catches in MessageHandler.
    reportDeliveryFailure(err, result, personality.name);
    // The marker still clears, but the throw means the real reply may not
    // have reached the user, so the row stays PENDING_DELIVERY.
    await finalize();
    return 'dropped';
  }
  await finalize();
  return 'delivered';
}
