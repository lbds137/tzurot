/**
 * API schemas for memory facts (memory Phase 2).
 *
 * Facts are atomic durable statements extracted asynchronously from verbatim
 * episodes, with a forward-only supersession chain. These schemas cover the
 * user-facing fact routes (list/get/correct/forget — slice 3); the extraction
 * worker's job payload lives in types/jobs.ts (factExtractionJobDataSchema).
 */

import { z } from 'zod';

/** Vocabulary for memory_facts.tier (varchar in Postgres, validated here). */
export const FACT_TIERS = ['observed', 'inferred', 'corrected'] as const;
export const FactTierSchema = z.enum(FACT_TIERS);

/** One fact row as the API returns it. */
export const FactItemSchema = z.object({
  id: z.string(),
  personalityId: z.string(),
  personaId: z.string().nullable(),
  statement: z.string(),
  entityTags: z.array(z.string()),
  salience: z.number().min(0).max(1),
  tier: FactTierSchema,
  isLocked: z.boolean(),
  /** ISO-8601 with offset — same serialization contract as MemoryItem dates. */
  validFrom: z.string().datetime({ offset: true }),
  /** Null while current; set when superseded by a newer fact or forgotten. */
  supersededAt: z.string().datetime({ offset: true }).nullable(),
  /** The superseding fact's id; null for current facts and terminal forgets. */
  supersededById: z.string().nullable(),
  forgotten: z.boolean(),
  /** Source episode Memory.ids (provenance). */
  sourceMemoryIds: z.array(z.string()),
  createdAt: z.string().datetime({ offset: true }),
});

/** GET /user/fact/list */
export const FactListResponseSchema = z.object({
  facts: z.array(FactItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
});

/** PATCH /user/fact/:id (the /memory correct path) — request body. */
export const CorrectFactRequestSchema = z.object({
  statement: z
    .string()
    .trim()
    .min(1, 'Corrected statement cannot be empty')
    .max(1000, 'Corrected statement too long'),
});

/** PATCH /user/fact/:id — response: the superseding corrected-tier fact. */
export const CorrectFactResponseSchema = z.object({
  fact: FactItemSchema,
  supersededFactId: z.string(),
});

/** DELETE /user/fact/:id (the /memory forget path) — response. */
export const ForgetFactResponseSchema = z.object({
  id: z.string(),
  forgotten: z.literal(true),
});
