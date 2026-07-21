/**
 * Denylist + NSFW gates for the character-turn slash path
 * (`/chat`, `/random`, `/chime-in`).
 *
 * The message pipeline runs these gates in `PersonalityChatManager.runGates`;
 * the slash path historically skipped them entirely, so a denylisted personality
 * could be invoked and age-gating was bypassed. This applies the SAME decision
 * logic — the shared `evaluateNsfwGate` for NSFW, the same denylist check with
 * bot-owner bypass — and renders any block through the interaction reply (the
 * message pipeline renders through `message.reply`; the decision is identical).
 */

import { type Channel, type SendableChannels } from 'discord.js';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { UserClient } from '@tzurot/clients';
import { type DeferredCommandContext } from '../../utils/commandContext/types.js';
import { getDenylistCache } from '../serviceRegistry.js';
import {
  evaluateNsfwGate,
  sendVerificationConfirmation,
  trackPendingVerificationMessage,
  NSFW_VERIFICATION_MESSAGE,
  NSFW_VERIFICATION_CHECK_FAILED_MESSAGE,
} from '../../utils/nsfwVerification.js';

const logger = createLogger('slash-chat-gates');

const DENYLIST_BLOCK_MESSAGE =
  "🚫 You don't have access to this character. If you think this is a mistake, contact the character's owner.";

/**
 * Run the denylist + NSFW gates for a slash-invoked chat turn. Returns `true`
 * when the turn is BLOCKED (the caller must stop after replying); `false` when
 * it may proceed. Any user-facing block message is sent via `context.editReply`.
 */
export async function runSlashChatGates(
  context: DeferredCommandContext,
  personality: LoadedPersonality,
  channel: Channel,
  userClient: UserClient
): Promise<boolean> {
  const actorId = context.user.id;

  // Denylist: best-effort moderation gate (bot owner bypasses). Skipped when the
  // cache isn't registered — degrades open, matching the message pipeline.
  const denylistCache = getDenylistCache();
  if (
    denylistCache !== undefined &&
    !isBotOwner(actorId) &&
    denylistCache.isPersonalityDenied(actorId, personality.id)
  ) {
    logger.debug(
      { userId: actorId, personalityId: personality.id },
      'User denied for this personality (slash) — blocking'
    );
    await context.editReply({ content: DENYLIST_BLOCK_MESSAGE });
    return true;
  }

  // NSFW age-gate — the same decision the message pipeline runs.
  const nsfw = await evaluateNsfwGate(userClient, channel);
  if (!nsfw.allowed) {
    const content =
      nsfw.reason === 'check-failed'
        ? NSFW_VERIFICATION_CHECK_FAILED_MESSAGE
        : NSFW_VERIFICATION_MESSAGE;
    const reply = await context.editReply({ content });
    if (nsfw.reason === 'not-verified') {
      logger.info(
        { userId: actorId, channelType: channel.type },
        'Interaction blocked (slash) - user not NSFW verified'
      );
      // Track the prompt so VerificationCleanupService can retract it later.
      void trackPendingVerificationMessage(actorId, reply.id, reply.channelId).catch(err => {
        logger.warn({ err, userId: actorId }, 'Failed to track slash verification message');
      });
    }
    return true;
  }

  if (nsfw.wasNewVerification) {
    // First-time verification gets a self-destructing confirmation in-channel.
    void sendVerificationConfirmation(channel as SendableChannels);
  }

  return false;
}
