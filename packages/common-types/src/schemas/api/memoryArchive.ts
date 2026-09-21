/**
 * Memory-archive auto-promotion wire contract — the request/response shape
 * for `POST /api/admin/memory-archive/promote`.
 */

import { z } from 'zod';

export const MemoryArchivePromoteRequestSchema = z.object({
  /** Evaluate and report candidates without writing anything. */
  dryRun: z.boolean().optional(),
});

export const MemoryArchivePromotionSchema = z.object({
  personalityId: z.string().uuid(),
  /** Deliberately looser than SLUG_PATTERN: these are gateway-produced from stored rows already validated at creation, so re-asserting the pattern here would only add a failure mode for a legacy row. */
  slug: z.string().min(1),
  /** Summarized share at evaluation time, 0..1. */
  coverage: z.number().min(0).max(1),
  writes: z.object({
    archiveSplitRender: z.boolean(),
    recentDaysDigest: z.boolean(),
    renderMode: z.boolean(),
  }),
});

export const MemoryArchivePromoteResponseSchema = z.object({
  /** False when the `archivePromotionEnabled` kill switch is off — no evaluation ran. */
  enabled: z.boolean(),
  evaluated: z.number().int(),
  promoted: z.array(MemoryArchivePromotionSchema),
  skipped: z.object({
    notReady: z.number().int(),
    optedOut: z.number().int(),
    alreadyListed: z.number().int(),
    /** Candidates whose settings write lost an optimistic-concurrency race, whose personality row changed or vanished under it, or whose config-defaults merge was rejected, or whose settings list was malformed. */
    conflicted: z.number().int(),
  }),
});

export type MemoryArchivePromotion = z.infer<typeof MemoryArchivePromotionSchema>;
export type MemoryArchivePromoteResponse = z.infer<typeof MemoryArchivePromoteResponseSchema>;
