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
    label: z
      .string()
      .regex(BROADCAST_LABEL_RE)
      .refine(label => !/^v\d/.test(label), {
        message:
          'Labels must not look like release tags ("v" followed by a digit) — that namespace belongs to GitHub release announcements.',
      })
      .optional(),
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
        /** Snowflake of the sent DM (status 'sent' only) — enables later cleanup. */
        sentMessageId: z.string().max(30).optional(),
        /**
         * Ledger row id of the user's PRIOR release DM the worker deleted
         * before this send (echoed from the batch payload's previousDm).
         * Present only when the delete succeeded or the message was already
         * gone — the gateway stamps that row's messageDeletedAt.
         */
        deletedPreviousDeliveryLogId: z.string().uuid().optional(),
      })
    )
    .min(1)
    .max(50),
});

/**
 * Final tally for a completed blast, carried on exactly ONE deliveries
 * response (the one whose report flipped completedAt). The bot-client worker
 * turns it into the owner-channel ops embed.
 */
export const BroadcastCompletionSummarySchema = z.object({
  version: z.string(),
  sent: z.number().int().min(0),
  /** Genuine delivery failures ONLY — resweep eligibility exclusions are not here. */
  failedPermanent: z.number().int().min(0),
  failedTransient: z.number().int().min(0),
  /**
   * Rows terminalized by the incomplete-broadcast resweep because the user
   * was no longer eligible (opted out / raised their level). Administrative
   * exclusions, not failures — kept out of failedPermanent so that number
   * stays a pure delivery-health signal.
   */
  optedOut: z.number().int().min(0),
});

export type BroadcastCompletionSummary = z.infer<typeof BroadcastCompletionSummarySchema>;

export const ReleaseBroadcastDeliveriesResponseSchema = z.object({
  /** Rows actually transitioned pending → terminal (idempotent re-reports skip). */
  updated: z.number().int().min(0),
  /** Internal user ids auto-disabled on their second consecutive permanent failure. */
  autoDisabledUserIds: z.array(z.string().uuid()),
  /**
   * True only on the response whose report stamped completedAt — derived from
   * the flip, not from "no pending rows remain," so a lost-response re-report
   * can never claim completion twice.
   */
  completed: z.boolean(),
  /** Present exactly when completed is true: the blast's final tally. */
  summary: BroadcastCompletionSummarySchema.optional(),
});

// ============================================================================
// POST /internal/release-broadcast/reconcile
// ============================================================================

/** Ceiling on the manual catch-up window: one week. */
export const RECONCILE_MAX_LOOKBACK_HOURS = 168;

export const ReleaseReconcileInputSchema = z.object({
  /**
   * How far back to consider GitHub releases for announcement. Defaults to
   * the sweep's own 24h window; raise it (≤168) to manually catch up a
   * release the hourly sweep aged out.
   */
  lookbackHours: z.number().int().min(1).max(RECONCILE_MAX_LOOKBACK_HOURS).optional(),
});

export const ReleaseReconcileResponseSchema = z.object({
  /** Non-draft, non-prerelease releases inside the lookback window. */
  checked: z.number().int().min(0),
  /** Versions announced by THIS run (newly enqueued blasts). */
  announced: z.array(z.string()),
  /** In-window releases that already had an announcement row. */
  alreadyAnnounced: z.number().int().min(0),
  /** In-window releases skipped by the draft/prerelease gate. */
  skipped: z.number().int().min(0),
  /** True when the per-run announcement cap stopped the sweep early. */
  capped: z.boolean(),
  /** Announced-but-incomplete sweep outcome (the second sweep of the run). */
  resweep: z
    .object({
      /** Incomplete announcements older than the wedge threshold. */
      scanned: z.number().int().min(0),
      /** Versions stamped complete directly (zero-pending / zero-row zombies). */
      stamped: z.array(z.string()),
      /** Versions whose pending rows were re-enqueued as fresh batches. */
      reEnqueued: z.array(z.string()),
      /** Pending rows terminalized because their user opted out post-enqueue. */
      optedOutTerminalized: z.number().int().min(0),
      /** True when the per-run cap stopped the sweep early. */
      capped: z.boolean(),
    })
    .optional(),
});
