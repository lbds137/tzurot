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
 * Response for POST /admin/db-sync — schema sync between Prisma and PostgreSQL.
 * The `result` spread carries fields like `tablesCreated`, `indexesCreated`,
 * etc., which vary per migration. We don't lock down the exact shape because
 * the operation is single-caller (bot owner via /admin db-sync command) and
 * the bot-client just displays the summary; no programmatic decision branches
 * on individual result fields.
 */
export const DbSyncResponseSchema = z
  .object({
    success: z.literal(true),
    timestamp: z.string(),
  })
  .passthrough();
export type DbSyncResponse = z.infer<typeof DbSyncResponseSchema>;

/**
 * Response for POST /admin/cleanup — orphan history / tombstone purge.
 * The `result` spread carries fields like `historyDeleted`, `tombstonesDeleted`,
 * `daysToKeep`, etc. `message` is a pre-formatted human-readable summary the
 * bot-client renders directly to Discord.
 */
export const AdminCleanupResponseSchema = z
  .object({
    success: z.literal(true),
    message: z.string(),
  })
  .passthrough();
export type AdminCleanupResponse = z.infer<typeof AdminCleanupResponseSchema>;

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
export type InvalidateCacheResponse = z.infer<typeof InvalidateCacheResponseSchema>;
