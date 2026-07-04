/**
 * Zod schemas for the `/api/internal/models` endpoint.
 *
 * The model catalog the bot-client `/models` command browses. The route is
 * service-auth only (bot-client → gateway); it surfaces the OpenRouter model
 * list (cached in `OpenRouterModelCache`) in the simplified shape below.
 *
 * `ModelAutocompleteOptionSchema` mirrors the `ModelAutocompleteOption`
 * interface in `types/ai.ts` — the type-parity test in `models.test.ts` fails
 * the build if the two drift.
 */

import { z } from 'zod';

/** One model in the catalog (simplified for autocomplete/browse + display). */
export const ModelAutocompleteOptionSchema = z.object({
  /** Model ID/slug for API calls. */
  id: z.string(),
  /** Human-readable display name. */
  name: z.string(),
  /** Context length in tokens. */
  contextLength: z.number(),
  /** Whether the model supports vision (image input). */
  supportsVision: z.boolean(),
  /** Whether the model supports image generation (image output). */
  supportsImageGeneration: z.boolean(),
  /** Whether the model supports audio input. */
  supportsAudioInput: z.boolean(),
  /** Whether the model supports audio output. */
  supportsAudioOutput: z.boolean(),
  /** Pricing per million prompt tokens. */
  promptPricePerMillion: z.number(),
  /** Pricing per million completion tokens. */
  completionPricePerMillion: z.number(),
  /** Release time (Unix seconds); absent for z.ai-catalog-only models. */
  created: z.number().optional(),
  /** True for OpenRouter meta-routers. Optional to tolerate cache entries written before this field existed. */
  isRouter: z.boolean().optional(),
});

/** Response shape for `GET /api/internal/models`. */
export const ModelsListResponseSchema = z.object({
  models: z.array(ModelAutocompleteOptionSchema),
  count: z.number(),
});
