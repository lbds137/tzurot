/**
 * Zod schemas for AI-route response shapes (`/ai/generate`, `/ai/transcribe`,
 * `/ai/job/:jobId`, `/ai/job/:jobId/confirm-delivery`).
 *
 * These routes are called service-to-service from bot-client (`GatewayClient`
 * direct-fetch path today; `ServiceClient` after the route-manifest cutover).
 * The bot-client side currently consumes raw `fetch().json()` outputs without
 * Zod validation; these schemas establish the contract going forward.
 *
 * The `result` field on generate / transcribe responses is the heavy payload
 * (full LLM completion or transcription artifacts). We accept it as
 * `z.unknown()` here because:
 *   (a) the full LLM result schema (`llmGenerationResultSchema`) lives in
 *       `types/schemas/generation.ts` and pulling it into the API schema
 *       layer would create a circular barrel risk
 *   (b) the audio transcription result is a TS-only interface
 *       (`AudioTranscriptionResult`) — equivalent Zod schema doesn't exist yet
 *   (c) the bot-client side casts to the correct TS type immediately after
 *       receiving; the schema-as-runtime-validator value is bounded
 *
 * If a future consumer needs runtime validation of `result`, tighten these
 * schemas at that point and adopt the existing `llmGenerationResultSchema`
 * (already a Zod schema, just not previously surfaced through this barrel).
 */

import { z } from 'zod';
import { JobStatus } from '../../constants/queue.js';

/**
 * Shared field shape for the AI-job acknowledgment envelope — the queued /
 * completed shape returned by `/ai/generate`, `/ai/transcribe`, and the shared
 * ack. Defined once and spread into each named schema below: knip's
 * duplicate-exports check rejects a pure alias (`X = Y`), but each `z.object(...)`
 * call below is a distinct schema VALUE, so this stays DRY without aliasing —
 * and the intention-revealing names remain the load-bearing piece for
 * generated-client return types.
 *
 * `result` and `timestamp` are present only when `wait=true` was requested on
 * the transcribe route OR when the deduplication cache returns a
 * previously-completed result; for the default async queueing path they're
 * absent. `result` stays `z.unknown()` because the heavy payload (full LLM
 * completion / transcription artifacts) is narrowed at the call site — see the
 * file header for why it isn't validated here.
 */
const aiJobAckShape = {
  jobId: z.string(),
  requestId: z.string(),
  status: z.nativeEnum(JobStatus),
  result: z.unknown().optional(),
  timestamp: z.string().optional(),
};

/** Shared queued/completed ack envelope for AI-job responses. */
export const AiJobAckResponseSchema = z.object(aiJobAckShape);

/** Response shape for POST /ai/generate. */
export const AiGenerateResponseSchema = z.object(aiJobAckShape);

/** Response shape for POST /ai/transcribe (`result` carries transcription content). */
export const AiTranscribeResponseSchema = z.object(aiJobAckShape);

/**
 * Response shape for GET /ai/job/:jobId — BullMQ job introspection.
 *
 * `state` mirrors BullMQ's job-state model (waiting | active | completed |
 * failed | delayed | paused | stuck | unknown). We keep it as `string` rather
 * than mirroring BullMQ's union here because (a) BullMQ owns the canonical
 * type, (b) we don't want a tight version coupling on a debug-only endpoint.
 */
export const AiJobStatusResponseSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  progress: z.unknown().optional(),
  result: z.unknown().optional(),
  timestamp: z.string(),
});

/**
 * Response shape for POST /ai/job/:jobId/confirm-delivery — bot-client
 * acknowledges the job result was successfully delivered to Discord.
 *
 * Two sub-shapes depending on whether the confirmation was idempotent:
 *   - first confirmation: `{ jobId, status: 'DELIVERED', message: 'Delivery confirmed' }`
 *   - duplicate confirmation: `{ jobId, status: <prior-status>, message: 'Already confirmed' }`
 * The schema is permissive on `status` to accept both.
 */
export const AiConfirmDeliveryResponseSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  message: z.string(),
});
