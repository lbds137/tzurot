/**
 * Resolve a personality's owner Discord ID for diagnostic snapshots.
 *
 * Bot-client's /inspect command compares `meta.personalityOwnerDiscordId` to
 * `interaction.user.id` (Discord snowflake) when computing whether a viewer
 * is the personality owner. The Personality table stores ownership as an
 * internal user UUID (`Personality.ownerId`); this helper bridges to the
 * Discord ID via a User lookup so the diagnostic meta uses the same ID
 * space as the bot-client comparison.
 *
 * Resilience: failure to resolve (deleted User row, transient DB error,
 * test environment without a database) is non-fatal. The caller stores
 * `null` in the meta and /inspect falls back to legacy "show everything"
 * behavior. Owner resolution is a UI affordance, not a correctness
 * invariant.
 */

import { createLogger, getPrismaClient } from '@tzurot/common-types';
import { DiagnosticCollector } from '../DiagnosticCollector.js';

const logger = createLogger('personalityOwnerResolver');

/**
 * Look up the Discord ID for the user whose internal UUID matches
 * `personalityOwnerInternalId`. Returns `null` on any failure (User not
 * found, transient DB error, no Prisma client).
 */
export async function resolvePersonalityOwnerDiscordId(
  personalityOwnerInternalId: string
): Promise<string | null> {
  try {
    const ownerUser = await getPrismaClient().user.findUnique({
      where: { id: personalityOwnerInternalId },
      select: { discordId: true },
    });
    return ownerUser?.discordId ?? null;
  } catch (err) {
    // warn rather than debug: a transient DB error here makes /inspect fall
    // back to "show everything" silently. Surfaced at warn so DB-pool-
    // exhaustion or misconfig is visible in ops logs without alerting noise.
    logger.warn(
      { err, personalityOwnerInternalId },
      'Failed to resolve personality owner Discord ID; diagnostic snapshot will omit it'
    );
    return null;
  }
}

/**
 * Build a DiagnosticCollector for a generation request, resolving the
 * personality owner's Discord ID for /inspect's owner-aware view rendering.
 *
 * Wrapping the resolve+construct pair in a single helper keeps GenerationStep
 * lean and centralizes the shape that diagnostic-meta needs at log creation.
 */
export async function createDiagnosticCollectorForRequest(args: {
  requestId: string;
  triggerMessageId?: string;
  userId: string;
  serverId?: string | null;
  channelId?: string;
  personalityId: string;
  personalityName: string;
  personalityOwnerInternalId: string;
}): Promise<DiagnosticCollector> {
  const personalityOwnerDiscordId = await resolvePersonalityOwnerDiscordId(
    args.personalityOwnerInternalId
  );
  return new DiagnosticCollector({
    requestId: args.requestId,
    triggerMessageId: args.triggerMessageId,
    personalityId: args.personalityId,
    personalityName: args.personalityName,
    personalityOwnerDiscordId,
    userId: args.userId,
    guildId: args.serverId ?? null,
    channelId: args.channelId ?? '',
  });
}
