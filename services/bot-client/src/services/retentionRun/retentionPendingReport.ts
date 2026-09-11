/**
 * Redis-backed one-slot stash for an undelivered live-run report.
 *
 * `postOwnerChannelEmbed` reports non-delivery as `false` — it catches
 * internally, pinned by ownerChannel.test.ts "swallows a send failure and
 * reports non-delivery". When the owner channel post fails (unset channel
 * id, a non-sendable channel, a caught error), the daily report would
 * otherwise be lost for good. The gateway's audit ledger stays the permanent
 * record of what a run did, but the embed is the only surface that
 * summarizes it for the owner — on an erasure day that summary is a
 * data-rights visibility gap, not cosmetic. This module stashes the embed's
 * wire shape in Redis and replays it on a later tick.
 *
 * One slot only: a second undelivered report before the first replays
 * overwrites it. The TTL bounds how long a channel-delivery retry can live
 * before the slot clears itself.
 */

import { EmbedBuilder, type Client } from 'discord.js';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { postOwnerChannelEmbed } from '../../utils/ownerChannel.js';
import { summarizeLiveRun } from './retentionRunReport.js';
import type { LiveRunOutcome } from './types.js';

const logger = createLogger('retention-run');

export const PENDING_REPORT_KEY = 'retention-run:pending-report';
export const PENDING_REPORT_TTL_SECONDS = 7 * 24 * 60 * 60;

// Envelope-only validation: `embed` is any object, because this module is its
// sole writer and the builder does not validate on reconstruction, so a bad
// embed reads as non-delivery at send time and expires with the TTL.
const PendingReportSchema = z.object({
  storedAt: z.string(),
  embed: z.object({}).passthrough(),
});

/**
 * Stash an undelivered live-run report for replay on a later tick. Logs only
 * aggregate counts (via `summarizeLiveRun`) — never user rows.
 */
export async function stashUndeliveredReport(
  redis: Redis,
  embed: EmbedBuilder,
  outcome: LiveRunOutcome
): Promise<void> {
  const payload = JSON.stringify({
    storedAt: new Date().toISOString(),
    embed: embed.toJSON(),
  });
  await redis.setex(PENDING_REPORT_KEY, PENDING_REPORT_TTL_SECONDS, payload);
  logger.warn(
    { ...summarizeLiveRun(outcome) },
    'Retention run report was not delivered; stashed for replay'
  );
}

/**
 * Replay a stashed report, if one exists. Returns whether it was delivered
 * this call. A payload that cannot be parsed or does not match the expected
 * shape is discarded immediately rather than left to hold the slot until its
 * TTL expires.
 */
export async function replayPendingReport(client: Client, redis: Redis): Promise<boolean> {
  const raw = await redis.get(PENDING_REPORT_KEY);
  if (raw === null) {
    return false;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    await redis.del(PENDING_REPORT_KEY);
    logger.warn({ err: error }, 'Stashed retention run report was not valid JSON; discarded');
    return false;
  }

  const result = PendingReportSchema.safeParse(parsedJson);
  if (!result.success) {
    await redis.del(PENDING_REPORT_KEY);
    logger.warn(
      { issues: result.error.issues },
      'Stashed retention run report failed validation; discarded'
    );
    return false;
  }

  // passthrough() leaves the field untyped as an APIEmbed, but its shape —
  // the wire form this module itself produced via embed.toJSON() in
  // stashUndeliveredReport — is structurally assignable, since every APIEmbed
  // field is optional; EmbedBuilder.from accepts it without a cast.
  const embed = EmbedBuilder.from(result.data.embed);
  const delivered = await postOwnerChannelEmbed(client, embed);
  if (delivered) {
    await redis.del(PENDING_REPORT_KEY);
    logger.info({ storedAt: result.data.storedAt }, 'Replayed a stashed retention run report');
    return true;
  }

  logger.warn(
    { storedAt: result.data.storedAt },
    'Stashed retention run report still not delivered; retrying next tick'
  );
  return false;
}
