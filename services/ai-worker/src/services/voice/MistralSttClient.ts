/**
 * Mistral STT Client
 *
 * Stateless HTTP wrapper for Mistral's `POST /v1/audio/transcriptions`
 * endpoint (Whisper-compatible). Sister to {@link MistralTtsClient}: the
 * same BYOK API key authorizes both, so callers fetch the key once via
 * `ApiKeyResolver.resolveApiKey(userId, AIProvider.Mistral)` and pass it
 * to whichever client they need.
 *
 * Endpoint shape (Whisper-compatible API, smoke-test confirmed in
 * `docs/research/voice-cloning-2026.md`):
 *   POST /v1/audio/transcriptions
 *     Auth:        Bearer ${apiKey}
 *     Body:        multipart/form-data with `file` field + optional `model`
 *     Response:    application/json with `{ text: string }`
 *
 * Error model mirrors {@link MistralTtsClient}:
 *   - 401/403 → MistralApiError (caller treats as auth/key issue, no retry)
 *   - 429/5xx → MistralApiError (caller's retry policy decides — see
 *     `isTransientMistralError` in AudioProcessor)
 *   - Network/abort → MistralTimeoutError (transient by definition)
 *   - Malformed response → MistralResponseShapeError
 */

import { AI_ENDPOINTS } from '@tzurot/common-types/constants/ai';
import { TimeoutError } from '@tzurot/common-types/utils/errors';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('MistralSttClient');

const BASE_URL = AI_ENDPOINTS.MISTRAL_BASE_URL;

/** STT requests can take longer than TTS for long voice messages — match
 *  the 60s ceiling used by the TTS path so the timeout failure mode is
 *  uniform across both directions. */
const MISTRAL_STT_TIMEOUT_MS = 60_000;

/**
 * Default Mistral STT model alias. `voxtral-mini-latest` is the only
 * `*-latest` alias Mistral publishes for Voxtral; the `voxtral-mini-transcribe-*`
 * family only ships pinned dated IDs (e.g., `voxtral-mini-transcribe-26-02`).
 * Picking the alias keeps us on Mistral's "current best" without code changes.
 *
 * Backlog item filed for startup-time canary monitoring — Mistral has
 * historically broken `*-latest` aliases on occasion; without monitoring,
 * those failures are silently absorbed by the voice-engine fallback path
 * and become invisible to operators.
 */
const DEFAULT_MISTRAL_STT_MODEL = 'voxtral-mini-latest';

// ============================================================================
// Public types
// ============================================================================

export interface MistralSTTOptions {
  audioBuffer: Buffer;
  /** Filename hint for the multipart upload — Mistral uses the extension
   *  to detect format, so `voice-message.ogg` matters more than the
   *  contentType field for some codecs. */
  filename: string;
  contentType: string;
  apiKey: string;
  /** Model override. Defaults to `voxtral-mini-latest`. */
  modelId?: string;
}

export interface MistralSTTResult {
  /** Whisper-compatible response shape: top-level `text` field. */
  text: string;
}

// ============================================================================
// Errors
// ============================================================================

export class MistralSttTimeoutError extends TimeoutError {
  constructor(timeoutMs: number, cause: Error) {
    super(timeoutMs, 'Mistral /v1/audio/transcriptions', cause);
    this.name = 'MistralSttTimeoutError';
  }
}

export class MistralSttApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`Mistral STT API error (${status}): ${detail}`);
    this.name = 'MistralSttApiError';
    this.status = status;
    this.detail = detail;
    Object.setPrototypeOf(this, MistralSttApiError.prototype);
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** True when the caller's retry policy should back off and try again
   *  (transient infrastructure problems). False for permanent / 4xx
   *  responses that retrying won't fix. */
  get isTransient(): boolean {
    return this.status === 429 || (this.status >= 500 && this.status < 600);
  }
}

export class MistralSttResponseShapeError extends Error {
  readonly body: unknown;

  constructor(message: string, body: unknown) {
    super(`Mistral STT response shape: ${message}`);
    this.name = 'MistralSttResponseShapeError';
    this.body = body;
    Object.setPrototypeOf(this, MistralSttResponseShapeError.prototype);
  }
}

// ============================================================================
// Internal helpers
// ============================================================================

async function readResponseError(response: globalThis.Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return `<failed to read body for status ${response.status}>`;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Transcribe an audio buffer via Mistral. Returns the decoded text on
 * success; throws one of the Mistral*Error types on failure (caller's
 * retry classifier maps each to retry-vs-fast-fail).
 */
export async function mistralTranscribeAudio(opts: MistralSTTOptions): Promise<MistralSTTResult> {
  const modelId = opts.modelId ?? DEFAULT_MISTRAL_STT_MODEL;

  // Multipart form-data with the audio buffer + model. Use the global
  // FormData/Blob — undici (Node 18+) supports them natively.
  const form = new FormData();
  // Buffer's underlying ArrayBufferLike could be a SharedArrayBuffer; BlobPart's
  // Uint8Array constraint is narrower (ArrayBuffer only). The double-cast is
  // required to bridge the two — pnpm `tsc` rejects the bare Buffer otherwise.
  const audioBlob = new Blob([opts.audioBuffer as unknown as ArrayBuffer], {
    type: opts.contentType,
  });
  form.append('file', audioBlob, opts.filename);
  form.append('model', modelId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MISTRAL_STT_TIMEOUT_MS);

  let response: globalThis.Response;
  try {
    response = await fetch(`${BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        // Do NOT set Content-Type — fetch derives the multipart boundary
        // automatically from the FormData body. Setting it manually breaks
        // the upload.
      },
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MistralSttTimeoutError(MISTRAL_STT_TIMEOUT_MS, error);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new MistralSttApiError(response.status, await readResponseError(response));
  }

  const json = await response.json();
  if (
    typeof json !== 'object' ||
    json === null ||
    typeof (json as { text?: unknown }).text !== 'string'
  ) {
    throw new MistralSttResponseShapeError('missing or non-string `text` field', json);
  }

  const text = (json as { text: string }).text;
  logger.info({ chars: text.length, modelId }, 'Mistral STT transcription succeeded');
  return { text };
}
