/**
 * Zod schemas for the /user/feedback intake endpoint.
 *
 * The abuse gates (cooldown, daily cap, near-dup dedupe) live in the gateway
 * handler, not here — this schema is only the cheap first gate (shape +
 * length). Rejections from the deeper gates come back as 400s whose message
 * names the specific limit.
 */

import { z } from 'zod';
import { FEEDBACK_LIMITS } from '../../constants/feedback.js';

// ============================================================================
// POST /user/feedback
// ============================================================================

export const SubmitFeedbackInputSchema = z.object({
  content: z
    .string()
    .transform(value => value.trim())
    .pipe(
      z
        .string()
        .min(1, 'Feedback content is required')
        .max(
          FEEDBACK_LIMITS.MAX_LENGTH,
          `Feedback must be at most ${FEEDBACK_LIMITS.MAX_LENGTH} characters`
        )
    ),
});

export const SubmitFeedbackResponseSchema = z.object({
  success: z.literal(true),
  feedbackId: z.string(),
});
