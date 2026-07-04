/**
 * Zod schemas for /user/nsfw API endpoints
 *
 * NSFW verification gates content per Discord ToS. Verification is one-way:
 * once verified, the row is set and never cleared. See `nsfwVerifiedAt`
 * field in prisma/schema.prisma (state-machine null pattern).
 */

import { z } from 'zod';

// ============================================================================
// GET /user/nsfw
// Returns user's current NSFW verification state
// ============================================================================

export const GetNsfwStatusResponseSchema = z.object({
  nsfwVerified: z.boolean(),
  nsfwVerifiedAt: z.string().nullable(),
});
// ============================================================================
// POST /user/nsfw/verify
// Marks user as NSFW verified; idempotent — already-verified returns the
// existing timestamp with alreadyVerified=true. The handler self-heals an
// inconsistent row (verified=true with null timestamp) by falling through
// to the re-verify path, so `nsfwVerifiedAt` is always a real timestamp.
// ============================================================================

export const VerifyNsfwResponseSchema = z.object({
  nsfwVerified: z.literal(true),
  nsfwVerifiedAt: z.string(),
  alreadyVerified: z.boolean(),
});
