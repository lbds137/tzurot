/**
 * StartupDMPrewarmer — Layer 1 of the post-deploy DM-silence fix.
 *
 * On bot startup, fetches the list of recently active Discord user IDs from
 * api-gateway (`GET /internal/users/recent`), then walks the list at a slow
 * rate-limited cadence calling `client.users.fetch(id).then(u => warmer.warm(u))`
 * to pre-populate Discord.js's DM channel cache for those users.
 *
 * Why slow (1/sec): the Discord.js REST manager processes requests through
 * a queue. Bursting createDM calls would compete with live user-traffic
 * REST requests for that queue's bandwidth (head-of-line blocking risk
 * flagged by council review). Pre-warming is background work with no
 * urgency — speed isn't the right axis to optimize.
 *
 * Why fire-and-forget: the bot must come online and service guild traffic
 * even if the gateway is slow or the recent-users list is unavailable.
 * A failed pre-warm degrades to Layer 2 (DMCacheWarmer) which still covers
 * users who interact via slash/button before DMing.
 *
 * Layer 1 closes the cold-start gap: a user whose first post-restart action
 * is a plain-text DM (the bug-trigger case) gets pre-cached at startup so
 * their DM dispatches correctly without prior interaction.
 */

import type { Client } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getOutboundDmAllowlist } from '@tzurot/common-types/utils/outboundDmAllowlist';
import { getServiceClient } from '../utils/gatewayClients.js';
import type { DMCacheWarmer } from './DMCacheWarmer.js';

const logger = createLogger('StartupDMPrewarmer');

/** Lookback window for the recent-users query. */
const SINCE_DAYS = 30;

/** Delay between createDM attempts in ms. 1/sec keeps us well under Discord's
 *  global rate limit and avoids head-of-line-blocking the REST queue with
 *  non-urgent background work. */
const RATE_LIMIT_DELAY_MS = 1000;

/**
 * Backoff delays for retrying the recent-users fetch when api-gateway isn't
 * yet ready. bot-client and api-gateway both auto-deploy from develop and
 * start in parallel; bot-client's `ClientReady` fires fast (~16s) while
 * api-gateway can take ~30s to finish registering routes. Without retry,
 * the prewarmer loses its window and Layer 1 silently no-ops until the
 * next deploy. Three attempts at 5s/15s/45s = 65s max delay covers the
 * observed startup race.
 */
const RETRY_DELAYS_MS = [5000, 15000, 45000];

interface StartupDMPrewarmerDeps {
  client: Client;
  warmer: DMCacheWarmer;
  /** Optional sleep override for testing with fake timers. */
  sleep?: (ms: number) => Promise<void>;
}

export class StartupDMPrewarmer {
  private readonly client: Client;
  private readonly warmer: DMCacheWarmer;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: StartupDMPrewarmerDeps) {
    this.client = deps.client;
    this.warmer = deps.warmer;
    this.sleep = deps.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  }

  /**
   * Fetch recently active users from api-gateway and pre-warm each one.
   * Returns when the loop finishes or the fetch fails. Designed for
   * fire-and-forget invocation from `ClientReady`.
   */
  async run(): Promise<void> {
    const start = Date.now();
    let discordIds: string[];
    try {
      discordIds = await this.fetchRecentUserIds();
    } catch (err) {
      logger.warn(
        { err },
        'Failed to fetch recent user list from api-gateway — skipping startup DM pre-warm; Layer 2 will handle live traffic'
      );
      return;
    }

    if (discordIds.length === 0) {
      logger.info({ sinceDays: SINCE_DAYS }, 'No recent users to pre-warm');
      return;
    }

    logger.info({ count: discordIds.length, sinceDays: SINCE_DAYS }, 'Starting DM cache pre-warm');

    let warmed = 0;
    let failed = 0;
    // Outbound gate: dev's db-synced user table is prod-shaped, so the
    // recent-users list can point the DEV bot at PROD users — the boot-burst
    // pattern behind the 340002 DM quarantine. When the allowlist is set,
    // warm only those users; unset (prod) warms everyone.
    const allowlist = getOutboundDmAllowlist();
    if (allowlist !== null) {
      const before = discordIds.length;
      discordIds = discordIds.filter(id => allowlist.has(id));
      logger.info(
        { before, after: discordIds.length },
        'Outbound DM allowlist active — prewarm list filtered'
      );
    }
    for (let i = 0; i < discordIds.length; i++) {
      const discordId = discordIds[i];
      try {
        const user = await this.client.users.fetch(discordId);
        this.warmer.warm(user);
        warmed += 1;
      } catch (err) {
        // Common: deleted accounts (10013), accounts the bot can't see, etc.
        // Logging at debug to avoid noise from expected attrition over a
        // 30-day lookback window.
        logger.debug({ err, discordId }, 'Skipping pre-warm for user');
        failed += 1;
      }
      // Sleep is a between-request rate limit, not a post-loop delay.
      // Skipping after the last user avoids a gratuitous 1-sec stall before
      // the completion log fires.
      if (i < discordIds.length - 1) {
        await this.sleep(RATE_LIMIT_DELAY_MS);
      }
    }

    const elapsedSec = Math.round((Date.now() - start) / 1000);
    // `warmed` = users.fetch() succeeded and warm() was invoked. createDM()
    // inside warm() runs fire-and-forget, so this counts "warming attempted"
    // not "DM channel definitively cached." `failed` counts users.fetch()
    // errors only (deleted accounts, etc.).
    logger.info({ warmed, failed, elapsedSec }, 'DM cache pre-warm complete');
  }

  private async fetchRecentUserIds(): Promise<string[]> {
    // Retry only on conditions that plausibly clear with time: 404 (route
    // not yet mounted), 5xx (server starting up), or network errors. Don't
    // retry on 4xx-other (auth/client errors won't fix themselves).
    const first = await this.fetchOnce();
    if (first.kind === 'success') {
      return first.ids;
    }
    if (first.kind === 'fatal') {
      throw first.err;
    }
    let lastError: Error = first.err;

    // One iteration per entry in RETRY_DELAYS_MS — total of 1 initial
    // attempt + 3 retries. Structure makes "no delay after last attempt"
    // obvious without an out-of-bounds-index guard.
    for (const delay of RETRY_DELAYS_MS) {
      logger.debug(
        { nextDelayMs: delay, err: lastError },
        'Retrying recent-users fetch after backoff'
      );
      await this.sleep(delay);
      const result = await this.fetchOnce();
      if (result.kind === 'success') {
        return result.ids;
      }
      if (result.kind === 'fatal') {
        throw result.err;
      }
      lastError = result.err;
    }
    throw lastError;
  }

  private async fetchOnce(): Promise<
    | { kind: 'success'; ids: string[] }
    | { kind: 'retry'; err: Error }
    | { kind: 'fatal'; err: Error }
  > {
    try {
      const result = await getServiceClient().recentUsers({ sinceDays: String(SINCE_DAYS) });
      if (result.ok) {
        return { kind: 'success', ids: result.data.discordIds };
      }
      if (result.status === 404 || result.status >= 500) {
        return {
          kind: 'retry',
          err: new Error(`api-gateway returned ${result.status} (transient)`),
        };
      }
      return { kind: 'fatal', err: new Error(`api-gateway returned ${result.status}`) };
    } catch (err) {
      // Network errors (ECONNREFUSED, DNS failures, etc.) are retry-able.
      return { kind: 'retry', err: err instanceof Error ? err : new Error(String(err)) };
    }
  }
}
