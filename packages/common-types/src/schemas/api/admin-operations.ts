/**
 * Zod schemas for admin OPERATIONAL routes: one-shot maintenance actions
 * (db-sync, cleanup, invalidate-cache) that return a success acknowledgment
 * plus operation-specific metadata.
 *
 * These differ from CRUD response shapes (which the per-resource schema
 * files cover) — they're imperative actions whose return value is
 * "what happened" rather than "the resource."
 *
 * The shapes use `.passthrough()` on extra fields because the handlers spread
 * an operation-result object into the response body (`{ success: true,
 * ...result, message }`). The exact `result` shape varies per operation and
 * is not stable enough to lock down in a Zod schema; the success flag +
 * message are the parts callers consume programmatically.
 */

import { z } from 'zod';

/**
 * Response for POST /admin/db-sync — schema/data sync between dev and prod.
 *
 * The gateway spreads a `SyncResult` into the body: per-table `stats`,
 * `warnings`/`info` string lists, the `schemaVersion`, and (dry-run only) a
 * `changes` preview of arbitrary shape. The bot-client renders these into an
 * embed. Enumerated explicitly so the consumer reads a typed shape instead of
 * casting; `changes` stays `unknown` (dry-run-only, free-form preview).
 */
export const DbSyncResponseSchema = z.object({
  success: z.literal(true),
  timestamp: z.string(),
  schemaVersion: z.string(),
  stats: z.record(
    z.string(),
    z.object({
      devToProd: z.number(),
      prodToDev: z.number(),
      conflicts: z.number(),
    })
  ),
  warnings: z.array(z.string()),
  info: z.array(z.string()),
  changes: z.unknown().optional(),
});

/**
 * Response for POST /admin/cleanup — orphan history / tombstone purge.
 * `message` is a pre-formatted human-readable summary the bot-client
 * renders directly to Discord. The numeric counts and timestamp are
 * the load-bearing fields the bot-client embeds rely on.
 */
export const AdminCleanupResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  historyDeleted: z.number().int().nonnegative(),
  tombstonesDeleted: z.number().int().nonnegative(),
  daysKept: z.number().int().nonnegative(),
  timestamp: z.string(),
});

/**
 * Response for POST /admin/invalidate-cache — single-personality or
 * bot-wide cache invalidation. Two response sub-shapes depending on the
 * input flag:
 *   - `{ success: true, personalityId, invalidated: 'caches', message }`
 *   - `{ success: true, invalidated: 'all', message }`
 * `personalityId` is optional to cover both shapes; `invalidated` is a
 * permissive string to accept both literal values without enum-coupling.
 */
export const InvalidateCacheResponseSchema = z
  .object({
    success: z.literal(true),
    invalidated: z.string(),
    message: z.string(),
    personalityId: z.string().optional(),
  })
  .passthrough();
