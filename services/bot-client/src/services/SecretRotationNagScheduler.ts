/**
 * Secret Rotation Nag Scheduler
 *
 * Daily check (plus one shortly after startup) of the gateway's
 * secret-rotation ledger; posts an owner-channel embed when any secret is
 * past its rotation interval.
 *
 * Cadence design: bot-client restarts on every deploy, so a weekly
 * setInterval would effectively never fire on this project. Instead the
 * CHECK runs daily/on-startup (restart-friendly — restarts make it fire
 * more often, never less) and a Redis cooldown key caps the NAG at one
 * post per week. The cooldown lives in Redis precisely because in-process
 * state dies with each deploy.
 */

import { EmbedBuilder, type Client } from 'discord.js';
import type { Redis } from 'ioredis';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getServiceClient } from '../utils/gatewayClients.js';
import { postOwnerChannelEmbed } from '../utils/ownerChannel.js';

const logger = createLogger('secret-rotation-nag');

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 60_000;
/** At most one nag per week, across restarts. */
const NAG_COOLDOWN_SECONDS = 7 * 24 * 60 * 60;
const COOLDOWN_KEY = 'secret-rotation-nag:cooldown';

let checkInterval: ReturnType<typeof setInterval> | null = null;

/** Start the daily overdue check (call once from the composition root). */
export function startSecretRotationNagScheduler(client: Client, redis: Redis): void {
  if (checkInterval !== null) {
    logger.warn('Scheduler already running');
    return;
  }

  checkInterval = setInterval(() => {
    void runCheck(client, redis);
  }, CHECK_INTERVAL_MS);

  setTimeout(() => {
    void runCheck(client, redis);
  }, STARTUP_DELAY_MS);

  logger.info({ intervalHours: CHECK_INTERVAL_MS / (60 * 60 * 1000) }, 'Started rotation nag');
}

/** Stop the scheduler (graceful shutdown). */
export function stopSecretRotationNagScheduler(): void {
  if (checkInterval !== null) {
    clearInterval(checkInterval);
    checkInterval = null;
    logger.info('Stopped rotation nag');
  }
}

/** Exported for tests — one full check cycle. */
export async function runCheck(client: Client, redis: Redis): Promise<void> {
  try {
    const result = await getServiceClient().secretRotationStatus();
    if (!result.ok) {
      logger.warn({ error: result.error }, 'Rotation-status fetch failed; skipping check');
      return;
    }
    const { entries, overdueCount } = result.data;
    if (overdueCount === 0) {
      return;
    }

    // Cooldown AFTER the overdue determination: a quiet week costs no Redis
    // read, and the key only exists while a nag is being suppressed.
    const cooling = await redis.get(COOLDOWN_KEY);
    if (cooling !== null) {
      logger.info({ overdueCount }, 'Overdue secrets present but nag is in cooldown');
      return;
    }

    const overdue = entries.filter(entry => entry.overdueDays > 0);
    const embed = new EmbedBuilder()
      .setTitle('🔑 Secret rotation overdue')
      .setDescription(
        overdue
          .map(
            entry =>
              `**${entry.name}** — ${String(entry.overdueDays)}d past its ${String(entry.intervalDays)}d interval (last rotated ${entry.rotatedAt.slice(0, 10)})`
          )
          .join('\n')
      )
      .setFooter({
        text: 'Rotate, then stamp: pnpm ops secrets:mark-rotated <name> (or secrets:rotate-byok)',
      })
      .setTimestamp();

    await postOwnerChannelEmbed(client, embed);
    await redis.setex(COOLDOWN_KEY, NAG_COOLDOWN_SECONDS, new Date().toISOString());
    logger.info({ overdueCount }, 'Posted rotation nag');
  } catch (error) {
    // Nag failure must never affect anything else; next daily tick retries.
    logger.warn({ err: error }, 'Rotation nag check failed');
  }
}
