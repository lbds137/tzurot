/**
 * Zod schema for GET /admin/stop-sequences — observability endpoint.
 *
 * Returns stop-sequence activation counts from the Redis tracker that the
 * ai-worker writes to whenever an LLM completion is truncated by a stop
 * sequence. Used by the bot owner to debug "the model keeps stopping mid-
 * sentence" complaints.
 */

import { z } from 'zod';

/**
 * Response for GET /admin/stop-sequences. Two breakdown maps + a total.
 *
 *  - `bySequence`: map of stop-sequence string → activation count
 *  - `byModel`: map of model ID → activation count
 *  - `totalActivations`: sum across all sequences
 */
export const StopSequencesResponseSchema = z.object({
  totalActivations: z.number().int().nonnegative(),
  bySequence: z.record(z.string(), z.number().int().nonnegative()),
  byModel: z.record(z.string(), z.number().int().nonnegative()),
});
export type StopSequencesResponse = z.infer<typeof StopSequencesResponseSchema>;
