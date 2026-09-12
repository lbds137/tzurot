/**
 * Zod schemas for /user/personality/:slug/default-config API endpoints.
 *
 * Sets or clears the personality-level default LLM config for a slot (text |
 * vision) — the `PersonalityDefaultConfig` / `PersonalityVisionDefaultConfig`
 * rows the config-resolver cascade reads after the user tiers and before the
 * admin default.
 */

import { z } from 'zod';
import { MODEL_SLOTS } from '../../constants/ai.js';

/** `.strict()` so an unknown key is a parse error, not a silently-dropped field. */
export const SetPersonalityDefaultConfigRequestSchema = z
  .object({
    configId: z.string().uuid('Invalid configId format'),
  })
  .strict();

export const SetPersonalityDefaultConfigResponseSchema = z.object({
  slot: z.enum(MODEL_SLOTS),
  config: z.object({
    id: z.string(),
    name: z.string(),
    model: z.string(),
  }),
});

export const ClearPersonalityDefaultConfigResponseSchema = z.object({
  success: z.literal(true),
});
