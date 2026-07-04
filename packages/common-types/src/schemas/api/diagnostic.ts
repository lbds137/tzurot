/**
 * Zod schemas for diagnostic-route response shapes.
 *
 * The diagnostic routes return LLM-pipeline traces (the "flight recorder"
 * for prompt construction) so the bot owner can debug what was sent and
 * what came back.
 *
 * The `data` field is the full `DiagnosticPayload` JSONB blob written by
 * our own ai-worker pipeline — trusted internal data. We type it as
 * `z.unknown()` here rather than mirroring the entire `DiagnosticPayload`
 * interface in Zod, because:
 *   (a) the payload is large and structurally complex
 *   (b) we trust the write path; the read path doesn't need to re-validate
 *   (c) callers cast it back to `DiagnosticPayload` after the boundary
 *
 * Input schema (`DiagnosticUpdateSchema`) lives in `./admin.ts` for now.
 * That coupling is a tech-debt residue we can clean up later.
 */

import { z } from 'zod';

/**
 * Shape of a single diagnostic log returned by GET /diagnostic/:requestId,
 * GET /diagnostic/by-message/:messageId (one entry in the logs array), and
 * GET /diagnostic/by-response/:messageId (the `log` field).
 *
 * Many fields are nullable because diagnostic logs can be written without
 * full context (e.g., when a personality/user/guild lookup fails post-hoc).
 */
export const DiagnosticLogSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  triggerMessageId: z.string().nullable(),
  personalityId: z.string().nullable(),
  userId: z.string().nullable(),
  guildId: z.string().nullable(),
  channelId: z.string().nullable(),
  model: z.string(),
  provider: z.string(),
  durationMs: z.number(),
  // ISO-8601 string after JSON serialization; the route handler returns a
  // Date object but Express's JSON serializer stringifies it. Both shapes
  // need to be accepted because some tests construct payloads directly.
  createdAt: z.union([z.string(), z.date()]),
  // Trusted JSONB from ai-worker — see file header. Callers cast back to
  // DiagnosticPayload at the boundary.
  data: z.unknown(),
});

export type DiagnosticLog = z.infer<typeof DiagnosticLogSchema>;

/**
 * Response shape for GET /diagnostic/:requestId and
 * GET /diagnostic/by-response/:messageId — a single log.
 */
export const DiagnosticLogResponseSchema = z.object({
  log: DiagnosticLogSchema,
});

export type DiagnosticLogResponse = z.infer<typeof DiagnosticLogResponseSchema>;

/**
 * Response shape for GET /diagnostic/by-message/:messageId — multiple logs
 * (a single trigger message can spawn multiple AI generations if the
 * personality fires multiple times, e.g., in a multi-personality reply).
 */
export const DiagnosticLogsResponseSchema = z.object({
  logs: z.array(DiagnosticLogSchema),
  count: z.number().int().nonnegative(),
});

export type DiagnosticLogsResponse = z.infer<typeof DiagnosticLogsResponseSchema>;

/**
 * Shape of a single entry in the GET /diagnostic/recent response — a
 * lightweight summary (no full `data` JSONB), with `personalityName`
 * extracted from the JSONB via `data #>> '{meta,personalityName}'`.
 */
export const RecentDiagnosticLogSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  personalityId: z.string().nullable(),
  userId: z.string().nullable(),
  guildId: z.string().nullable(),
  channelId: z.string().nullable(),
  model: z.string(),
  provider: z.string(),
  durationMs: z.number(),
  createdAt: z.union([z.string(), z.date()]),
  personalityName: z.string().nullable(),
});

/**
 * Response shape for GET /diagnostic/recent — up to 100 most recent logs.
 */
export const RecentDiagnosticLogsResponseSchema = z.object({
  logs: z.array(RecentDiagnosticLogSchema),
  count: z.number().int().nonnegative(),
});

export type RecentDiagnosticLogsResponse = z.infer<typeof RecentDiagnosticLogsResponseSchema>;

/**
 * Response shape for PATCH /diagnostic/:requestId/response-ids.
 * Just acknowledges the update succeeded.
 */
export const DiagnosticUpdateResponseSchema = z.object({
  success: z.literal(true),
});
