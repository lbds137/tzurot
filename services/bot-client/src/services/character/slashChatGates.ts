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
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';
import {
  evaluateNsfwGate,
  sendVerificationConfirmation,
  trackPendingVerificationMessage,
  nsfwVerificationMessage,
  NSFW_VERIFICATION_CHECK_FAILED_MESSAGE,
} from '../../utils/nsfwVerification.js';

const logger = createLogger('slash-chat-gates');

const DENYLIST_BLOCK_MESSAGE =
  "🚫 You don't have access to this character. If you think this is a mistake, contact the character's owner.";

/**
 * Whether `actorId` is denied access to `personalityId` — the denylist half
 * of the gate, factored out so a caller that needs the verdict BEFORE the
 * per-turn gate runs (the tag chime-in's pre-sample filter) shares the exact
 * predicate rather than re-deriving it. Degrades open (returns `false`) when
 * the denylist cache isn't registered, and always returns `false` for the bot
 * owner — matching `runSlashChatGates`'s bypass.
 */
export function isDeniedForActor(actorId: string, personalityId: string): boolean {
  const denylistCache = getDenylistCache();
  if (denylistCache === undefined || isBotOwner(actorId)) {
    return false;
  }
  return denylistCache.isPersonalityDenied(actorId, personalityId);
}

/**
 * The NSFW age-gate half of `runSlashChatGates`, factored out so a caller
 * that needs to run it independently of the denylist check (the tag
 * chime-in's up-front gate) shares the exact message selection, tracking,
 * and confirmation behavior. Returns `true` when BLOCKED; any user-facing
 * block message is sent via `context.editReply`.
 */
export async function runSlashNsfwGate(
  context: DeferredCommandContext,
  channel: Channel,
  userClient: UserClient
): Promise<boolean> {
  const actorId = context.user.id;

  const nsfw = await evaluateNsfwGate(userClient, channel);
  if (!nsfw.allowed) {
    const content =
      nsfw.reason === 'check-failed'
        ? NSFW_VERIFICATION_CHECK_FAILED_MESSAGE
        : nsfwVerificationMessage();
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
  if (isDeniedForActor(actorId, personality.id)) {
    // MUTE's contract is that the bot never acknowledges the denial. A slash
    // interaction must be acked, so the closest available behaviour is a reply
    // indistinguishable from a transient failure — the same catalog entry and
    // action string `handleChatError` renders for these commands. BLOCK keeps
    // the explicit notice.
    //
    // `isDeniedForActor` returning true guarantees the cache is registered
    // (it only ever returns true after consulting one), so the `?? false`
    // below is unreachable in practice — kept instead of a non-null assertion
    // because the two lookups are independent calls with no shared type proof.
    const muted = getDenylistCache()?.isPersonalityMuted(actorId, personality.id) ?? false;
    logger.debug(
      { userId: actorId, personalityId: personality.id, muted },
      'User denied for this personality (slash) — blocking'
    );
    const content = muted
      ? renderSpec(CATALOG.error.operationFailed('process the chat request'))
      : DENYLIST_BLOCK_MESSAGE;
    await context.editReply({ content });
    return true;
  }

  // NSFW age-gate — the same decision the message pipeline runs.
  return runSlashNsfwGate(context, channel, userClient);
}
