/**
 * GET /internal/users/recent?sinceDays=30
 *
 * Returns Discord IDs of users with usage_logs activity in the last N days.
 * Service-auth protected (global middleware in api-gateway/src/index.ts).
 *
 * Used by bot-client at startup to pre-populate the Discord.js DM channel
 * cache so plain-text DMs route correctly without requiring the user to
 * first interact via slash command. Layer 1 of the post-deploy DM-silence
 * fix; Layer 2 (lazy-on-interaction) lives in bot-client/services/DMCacheWarmer.
 */

import { type Request, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  RecentUsersResponseSchema,
  DiscordSnowflakeSchema,
} from '@tzurot/common-types/schemas/api/internal';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getOutboundDmAllowlist } from '@tzurot/common-types/utils/outboundDmAllowlist';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('internal-users-recent');

/**
 * Defensive cap on rows returned. Real-world usage for a personal-scale bot
 * is well under this number; the LIMIT exists to prevent pathological cases
 * (e.g., a usage_logs backfill bug producing millions of rows) from generating
 * a runaway response that the bot would then try to warm one-by-one.
 */
const MAX_RESULTS = 1000;

/** Default lookback window in days when no sinceDays query param provided. */
const DEFAULT_SINCE_DAYS = 30;

/** Hard cap on sinceDays to prevent abuse via crafted query params. */
const MAX_SINCE_DAYS = 365;

interface RawRow {
  discord_id: string;
}

/** GET /api/internal/users/recent — Discord IDs of recently-active users. */
export const handleRecentUsers = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: Request, res: Response) => {
    // Parse and validate sinceDays query param. Number() + Number.isInteger()
    // is strictly stricter than parseInt(): rejects partial-numeric strings
    // like "30abc" (parseInt would silently accept as 30) and float values.
    const rawSinceDays = req.query.sinceDays;
    let sinceDays = DEFAULT_SINCE_DAYS;
    if (typeof rawSinceDays === 'string') {
      const parsed = Number(rawSinceDays);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_SINCE_DAYS) {
        return sendError(
          res,
          ErrorResponses.validationError(`sinceDays must be a positive integer ≤ ${MAX_SINCE_DAYS}`)
        );
      }
      sinceDays = parsed;
    }

    // INNER JOIN avoids a full usage_logs scan that the IN-subquery shape can
    // produce on some query plans. GROUP BY collapses multi-request users.
    // ORDER BY MAX(ul.created_at) DESC ensures that when LIMIT clips, we get
    // the most-recently-active users (deterministic + meaningful order).
    // LIMIT is a defensive cap (see MAX_RESULTS). Both `sinceDays` and
    // `MAX_RESULTS` go through Prisma's parameterized binding via the tagged
    // template — `MAX_RESULTS` is a compile-time constant so this is safe by
    // shape, and using `$queryRaw` keeps the project's preference (per
    // `03-database.md`) for the safer-by-default API.
    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT u.discord_id
      FROM users u
      INNER JOIN usage_logs ul ON ul.user_id = u.id
      WHERE ul.created_at > NOW() - (${sinceDays} * INTERVAL '1 day')
      GROUP BY u.discord_id
      ORDER BY MAX(ul.created_at) DESC
      LIMIT ${MAX_RESULTS}
    `;

    const allIds = rows.map(r => r.discord_id);

    // Snapshot BEFORE the snowflake + allowlist filters below: atLimit means
    // "the QUERY hit MAX_RESULTS" (rows may have been clipped). Computing it
    // from the post-filter count under-reports — on dev with the allowlist
    // gate active it reads false even when the query clipped.
    const atLimit = rows.length === MAX_RESULTS;

    // Filter non-snowflake IDs before schema validation. The DB stores
    // snowflakes by schema (`discord_id @db.VarChar(20)`), so this guards
    // against a near-zero data-drift scenario (migration leakage, test
    // contamination). Filtering first preserves the rest of the batch
    // rather than failing the whole pre-warm with a 500. Uses the canonical
    // DiscordSnowflakeSchema so the validation here can never drift from
    // the schema's own definition.
    let discordIds = allIds.filter(id => DiscordSnowflakeSchema.safeParse(id).success);
    const filtered = allIds.length - discordIds.length;
    if (filtered > 0) {
      logger.warn({ filtered }, 'Filtered non-snowflake discord_ids from DB result');
    }

    // Outbound gate before the service boundary (post-query — unlike the
    // broadcast resolver's SQL-level narrowing, fine at this endpoint's
    // LIMIT-bounded scale): this endpoint feeds the DM prewarmer, and on dev
    // the db-synced usage rows are prod-shaped — without the filter, prod
    // Discord IDs cross into bot-client just to be discarded (or worse,
    // warmed) downstream.
    const allowlist = getOutboundDmAllowlist();
    if (allowlist !== null) {
      const before = discordIds.length;
      discordIds = discordIds.filter(id => allowlist.has(id));
      logger.info(
        { before, after: discordIds.length },
        'Outbound DM allowlist active — recent-users list filtered'
      );
    }

    const parsed = RecentUsersResponseSchema.parse({ discordIds, sinceDays });

    // `atLimit: true` means the raw query returned exactly MAX_RESULTS rows.
    // That's the signal LIMIT clipped — but technically also true if exactly
    // MAX_RESULTS users were active in the window with no extras. Use as a
    // "rows may have been dropped" indicator, not an absolute truth.
    logger.info({ sinceDays, total: discordIds.length, atLimit }, 'Returning recent active users');

    sendCustomSuccess(res, parsed, StatusCodes.OK);
  });
};
