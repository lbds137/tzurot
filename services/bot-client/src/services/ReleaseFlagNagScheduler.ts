/**
 * Release Flag Nag Scheduler
 *
 * Daily check (plus one shortly after startup) of the GitHub releases API;
 * posts an owner-channel embed when the newest published release is still
 * flagged prerelease. That flag doubles as api-gateway's "current release
 * only" announce gate — if it's stuck on, every release DM silently stops
 * going out, and nothing else in the stack surfaces the mis-state on its
 * own (the gateway sweep's WARN log is the other half of this detection;
 * this is the owner-facing half).
 *
 * Cadence design mirrors SecretRotationNagScheduler: bot-client restarts on
 * every deploy, so a weekly setInterval would effectively never fire. The
 * CHECK runs daily/on-startup (restart-friendly — restarts make it fire
 * more often, never less) and a Redis cooldown key caps the NAG at one post
 * per week PER RELEASE (the key stores the nagged tag, so a different
 * release becoming flagged is a new incident), surviving deploys precisely
 * because in-process state does not.
 *
 * Deliberately independent of api-gateway: cross-service imports are an
 * architecture violation (depcruise-enforced), so this fetches the GitHub
 * releases API directly rather than reusing the gateway's reconcile sweep.
 */

import { EmbedBuilder, type Client } from 'discord.js';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { getConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { VALIDATION_TIMEOUTS } from '@tzurot/common-types/constants/timing';
import {
  GitHubReleaseSchema,
  newestPublishedRelease,
  type GitHubRelease,
} from '@tzurot/common-types/schemas/github/release';
import { createIntervalScheduler } from '../utils/intervalScheduler.js';
import { postOwnerChannelEmbed } from '../utils/ownerChannel.js';

const logger = createLogger('release-flag-nag');

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 60_000;
/** At most one nag per week PER RELEASE, across restarts. */
const NAG_COOLDOWN_SECONDS = 7 * 24 * 60 * 60;
const COOLDOWN_KEY = 'release-flag-nag:cooldown';

// per_page=5 (vs the gateway reconcile's 30): this check needs only the newest
// published release, and 5 absorbs GitHub's creation-order-vs-published_at
// skew plus a draft-heavy top of the list. The reconcile fetches 30 because it
// must cover a whole lookback window, not just the newest.
const GITHUB_RELEASES_URL = 'https://api.github.com/repos/lbds137/tzurot/releases?per_page=5';

const scheduler = createIntervalScheduler<[Client, Redis]>({
  intervalMs: CHECK_INTERVAL_MS,
  startupDelayMs: STARTUP_DELAY_MS,
  logger,
  run: (client, redis) => runReleaseFlagNagCheck(client, redis),
});

/** Start the daily prerelease-flag check (call once from the composition root). */
export function startReleaseFlagNagScheduler(client: Client, redis: Redis): void {
  scheduler.start(client, redis);
}

/** Stop the scheduler (graceful shutdown). */
export function stopReleaseFlagNagScheduler(): void {
  scheduler.stop();
}

/** undefined = fetch/parse failure (best-effort, retried next tick). */
async function fetchNewestRelease(): Promise<GitHubRelease | null | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUTS.EXTERNAL_GITHUB_API_CALL);
  try {
    const token = getConfig().GITHUB_API_TOKEN;
    const response = await fetch(GITHUB_RELEASES_URL, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'tzurot-bot-client',
        ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, 'GitHub releases fetch failed; skipping check');
      return undefined;
    }
    const payload: unknown = await response.json();
    const parsed = z.array(GitHubReleaseSchema).safeParse(payload);
    if (!parsed.success) {
      logger.warn('GitHub releases payload failed schema validation; skipping check');
      return undefined;
    }
    return newestPublishedRelease(parsed.data);
  } finally {
    clearTimeout(timer);
  }
}

/** Exported for tests — one full check cycle. */
export async function runReleaseFlagNagCheck(client: Client, redis: Redis): Promise<void> {
  try {
    const newest = await fetchNewestRelease();
    if (newest?.prerelease !== true) {
      return;
    }

    // Cooldown AFTER the mis-state determination: a healthy week costs no
    // Redis read, and the key only exists while a nag is being suppressed.
    // The key's VALUE is the nagged tag: a cooldown only silences the SAME
    // release — a different release becoming newest-and-flagged during the
    // window is a new incident and nags immediately.
    const cooling = await redis.get(COOLDOWN_KEY);
    if (cooling === newest.tag_name) {
      logger.info(
        { version: newest.tag_name },
        'Newest release is prerelease but nag is in cooldown'
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('🚩 Newest GitHub release is still prerelease-flagged')
      .setDescription(
        `**${newest.tag_name}** is the newest published release but is flagged \`prerelease\` — release DMs are silently suppressed until it is demoted.\n\n` +
          `Fix: re-run \`pnpm ops release:publish\`, or \`gh release edit ${newest.tag_name} --prerelease=false --latest\`.`
      )
      .setTimestamp();

    // Arm the cooldown only on confirmed delivery: a swallowed post failure
    // must not buy a week of silence — the next daily tick retries instead.
    const delivered = await postOwnerChannelEmbed(client, embed);
    if (delivered) {
      await redis.setex(COOLDOWN_KEY, NAG_COOLDOWN_SECONDS, newest.tag_name);
      logger.info({ version: newest.tag_name }, 'Posted release-flag nag');
    } else {
      logger.warn(
        { version: newest.tag_name },
        'Release-flag nag embed was not delivered; will retry next tick'
      );
    }
  } catch (error) {
    // Nag failure must never affect anything else; next daily tick retries.
    logger.warn({ err: error }, 'Release-flag nag check failed');
  }
}
