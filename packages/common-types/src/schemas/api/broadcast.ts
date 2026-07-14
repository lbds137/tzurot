/**
 * Zod schemas for the release-broadcast endpoints:
 * - POST /admin/broadcast (owner-only blast + dry-run)
 * - POST /internal/release-broadcast/:releaseId/pending (worker double-DM guard)
 * - POST /internal/release-broadcast/:releaseId/deliveries (delivery-status ledger)
 *
 * These schemas define the contract between api-gateway and bot-client.
 */

import { z } from 'zod';
import { NotifyLevelSchema } from './notifications.js';

/** Discord DM hard cap is 2000; the cap leaves room for the opt-out footer. */
export const BROADCAST_MESSAGE_MAX_LENGTH = 1800;

/**
 * Version labels land in release_announcements.version (VarChar(50), unique).
 * Restricted charset keeps them log- and URL-safe.
 */
export const BROADCAST_LABEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,49}$/;

// ============================================================================
// POST /admin/broadcast
// ============================================================================

export const BroadcastInputSchema = z
  .object({
    message: z.string().min(1).max(BROADCAST_MESSAGE_MAX_LENGTH),
    /** Message importance — `major` reaches everyone opted in (see NotifyLevel). */
    level: NotifyLevelSchema.default('major'),
    /** Unique version label; the handler derives a timestamped default when omitted. */
    label: z.string().regex(BROADCAST_LABEL_RE).optional(),
    dryRun: z.boolean().optional().default(false),
    /** Double-key for real sends: a blast with no undo requires confirm: true. */
    confirm: z.boolean().optional().default(false),
  })
  .refine(input => input.dryRun || input.confirm, {
    message: 'A real send requires confirm:true — use dry-run:true to preview the audience.',
  });

const broadcastDryRunResultSchema = z.object({
  dryRun: z.literal(true),
  eligibleCount: z.number().int().min(0),
  /** Capped preview of who would receive the DM. */
  sample: z.array(z.object({ username: z.string() })),
});

const broadcastEnqueuedResultSchema = z.object({
  dryRun: z.literal(false),
  version: z.string(),
  releaseId: z.string().uuid(),
  recipients: z.number().int().min(0),
  batches: z.number().int().min(0),
});

export const BroadcastResponseSchema = z.discriminatedUnion('dryRun', [
  broadcastDryRunResultSchema,
  broadcastEnqueuedResultSchema,
]);

// ============================================================================
// POST /internal/release-broadcast/:releaseId/pending
// ============================================================================

export const ReleaseBroadcastPendingInputSchema = z.object({
  deliveryLogIds: z.array(z.string().uuid()).min(1).max(50),
});

export const ReleaseBroadcastPendingResponseSchema = z.object({
  /** Subset of the requested ids still awaiting delivery. */
  pendingDeliveryLogIds: z.array(z.string().uuid()),
});

// ============================================================================
// POST /internal/release-broadcast/:releaseId/deliveries
// ============================================================================

/** Terminal delivery outcomes the worker may report (pending is not reportable). */
export const DeliveryOutcomeSchema = z.enum(['sent', 'failed_transient', 'failed_permanent']);

export type DeliveryOutcome = z.infer<typeof DeliveryOutcomeSchema>;

export const ReleaseBroadcastDeliveriesInputSchema = z.object({
  results: z
    .array(
      z.object({
        deliveryLogId: z.string().uuid(),
        status: DeliveryOutcomeSchema,
        /** Discord error class (e.g. '50007') — required company for failed_* rows. */
        errorCode: z.string().max(50).optional(),
      })
    )
    .min(1)
    .max(50),
});

export const ReleaseBroadcastDeliveriesResponseSchema = z.object({
  /** Rows actually transitioned pending → terminal (idempotent re-reports skip). */
  updated: z.number().int().min(0),
  /** Internal user ids auto-disabled on their second consecutive permanent failure. */
  autoDisabledUserIds: z.array(z.string().uuid()),
  /** True once the announcement has no pending rows left (completedAt stamped). */
  completed: z.boolean(),
});
