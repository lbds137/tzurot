/**
 * Zod schemas for the voice-engine JSON RESPONSE shapes.
 *
 * These are the CONSUMER half of the cross-language (Python ↔ TypeScript) contract:
 * `VoiceEngineClient` validates real responses with `.parse()` (runtime safety —
 * a Python field rename throws a clear error instead of silently producing
 * `undefined` down the audio-transcription path), and the consumer contract test
 * (`VoiceEngineContract.consumer.contract.test.ts`) validates the SAME committed
 * fixtures (`packages/test-utils/fixtures/contracts/voice-engine/`) the Python
 * PRODUCER test (`services/voice-engine/tests/test_contract.py`) asserts its real
 * output against. The fixture is the shared artifact; neither side imports the other.
 *
 * Validation scope: each schema REQUIRES the fields the client actually reads and
 * marks the rest OPTIONAL. A rename/removal of a read field is caught here (it goes
 * missing → `parse` throws); the FULL response shape is locked separately by the
 * Python producer test's fixture-equality assert. This keeps the running client
 * robust — a benign Python change to a field we don't read can't break it — while
 * still catching the drift that matters. (Extra/unknown fields are stripped, not
 * rejected, so a backward-compatible addition is also non-breaking.)
 *
 * Future evolution: if voice-engine grows past ~5 JSON endpoints, migrate to FastAPI
 * `response_model` → committed `openapi.json` → TS Zod codegen so the spec is the
 * single source of truth, retiring this hand-maintained schema+fixture pair.
 */

import { z } from 'zod';

/** POST /v1/transcribe → `{ text }` (the STT result that drives transcription). */
export const transcribeResponseSchema = z.object({ text: z.string() });

/**
 * GET /health → `{ status, asr_loaded, tts_loaded, voices_loaded }`. The client
 * reads only `asr_loaded` / `tts_loaded`; `status` / `voices_loaded` are validated
 * when present but optional (the client doesn't depend on them).
 */
export const healthResponseSchema = z.object({
  asr_loaded: z.boolean(),
  tts_loaded: z.boolean(),
  status: z.string().optional(),
  voices_loaded: z.number().optional(),
});

/**
 * GET /v1/voices → `{ voices: [{ id, type }] }`. The client reads only `id`; `type`
 * is validated when present but optional.
 */
export const voicesResponseSchema = z.object({
  voices: z.array(z.object({ id: z.string(), type: z.string().optional() })),
});
