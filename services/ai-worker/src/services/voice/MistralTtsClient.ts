/**
 * Mistral TTS Client
 *
 * Stateless HTTP functions for the Mistral Voxtral TTS API. Parallel to
 * `ElevenLabsClient` — each call takes an API key (BYOK; one key authorizes
 * all `/v1/audio/*` endpoints).
 *
 * Endpoints used (smoke-test confirmed shapes — see
 * `docs/research/voice-cloning-2026.md` "2026-05-02 Mistral smoke test"):
 *
 * - `POST /v1/audio/voices` — clone a voice from base64 reference audio.
 *   Mistral SILENTLY DROPS slug/languages/gender/age/tags on creation;
 *   only `name` survives. Cache strategy uses `name` as the find-or-create key.
 * - `GET  /v1/audio/voices?page=1&page_size=50` — paginated list. Single-page
 *   assumption (>50 cloned voices unrealistic at one-voice-per-personality
 *   scale; backlog item tracks the pagination loop fallback).
 * - `DELETE /v1/audio/voices/{id}` — remove voice (eviction).
 * - `POST /v1/audio/speech` — synthesize. Returns `application/json` with
 *   base64 `audio_data` field — NEVER raw binary, even with
 *   `response_format: 'wav'`. This client decodes at the boundary.
 *
 * Builder functions (`buildVoxtralSpeechBody`, `buildVoxtralVoiceCreateBody`)
 * isolate the request-body construction so when Mistral changes API shape
 * you touch one function. Free engineering hygiene.
 */

import { createLogger, AI_ENDPOINTS, TimeoutError } from '@tzurot/common-types';

const logger = createLogger('MistralTtsClient');

const BASE_URL = AI_ENDPOINTS.MISTRAL_BASE_URL;

/** Timeout for synthesis + clone calls (60s — comparable to ElevenLabs).
 *  Clone uses the same budget because the request body carries a base64-
 *  encoded reference audio buffer whose size isn't bounded — a slow
 *  upload on a constrained connection can exceed the fast timeout even
 *  though the smoke test (332-852ms on a fast link) suggested otherwise. */
const MISTRAL_TIMEOUT_MS = 60_000;
/** Shorter timeout for genuinely lightweight ops (list, delete) — no body
 *  uploads, fixed response size. */
const MISTRAL_FAST_TIMEOUT_MS = 15_000;
/** Default page size for list voices. Smoke test confirmed 50 works. */
const VOICE_LIST_PAGE_SIZE = 50;

// ============================================================================
// Public types
// ============================================================================

export interface MistralTTSOptions {
  text: string;
  /** UUID returned by `mistralCloneVoice` (not the slug we put in the name). */
  voiceId: string;
  apiKey: string;
  /** Mistral TTS model id. Defaults to `voxtral-mini-tts-latest`. */
  modelId?: string;
  /** Output codec inside the JSON-wrapped response. Defaults to `wav`. */
  responseFormat?: 'pcm' | 'wav' | 'mp3' | 'flac' | 'opus';
}

export interface MistralTTSResult {
  /** Decoded audio bytes (already base64-decoded from the JSON wrapper). */
  audioBuffer: Buffer;
  /** MIME type derived from `responseFormat`. */
  contentType: string;
}

export interface MistralVoiceInfo {
  /** UUID — what TTS calls reference. */
  id: string;
  /** Mistral preserves this field on create (slug/tags/etc. are dropped). */
  name: string;
  /** Null for preset voices; populated UUID for user-cloned. */
  userId: string | null;
}

export interface MistralCloneOptions {
  name: string;
  audioBuffer: Buffer;
  /** Source MIME type — Mistral uses the filename extension to detect format. */
  contentType: string;
  apiKey: string;
}

// ============================================================================
// Errors
// ============================================================================

export class MistralTimeoutError extends TimeoutError {
  constructor(timeoutMs: number, endpoint: string, cause: Error) {
    super(timeoutMs, `Mistral ${endpoint}`, cause);
    this.name = 'MistralTimeoutError';
  }
}

export class MistralApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`Mistral API error (${status}): ${detail}`);
    this.name = 'MistralApiError';
    this.status = status;
    this.detail = detail;
    Object.setPrototypeOf(this, MistralApiError.prototype);
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** Transient: 429 + 5xx (worth retrying / falling back). */
  get isTransient(): boolean {
    return this.isRateLimited || this.status >= 500;
  }
}

/**
 * Mistral returned a 2xx HTTP response with a body that doesn't match the
 * expected shape (missing `audio_data`, missing `id`, missing `items`, etc.).
 *
 * Distinct from `MistralApiError` (which carries an HTTP error status) so
 * log analysis doesn't see "MistralApiError(200, ...)" and read it as
 * success. Treated as transient by the dispatcher (the response shape may
 * stabilize on retry — Mistral's API is in active evolution).
 */
export class MistralResponseShapeError extends Error {
  readonly endpoint: string;
  readonly missingField: string;

  constructor(endpoint: string, missingField: string, detail?: string) {
    super(
      `Mistral ${endpoint} returned malformed response body: missing ${missingField}${detail !== undefined ? ` — ${detail}` : ''}`
    );
    this.name = 'MistralResponseShapeError';
    this.endpoint = endpoint;
    this.missingField = missingField;
    Object.setPrototypeOf(this, MistralResponseShapeError.prototype);
  }

  /** Transient: response-shape failures may stabilize on retry. */
  readonly isTransient = true;
}

// ============================================================================
// Request body builders (isolated for API volatility per plan section 5)
// ============================================================================

/**
 * Build the JSON body for `POST /v1/audio/speech`.
 *
 * Isolated from the call site so when Mistral changes the API shape (or
 * when an alternate transport emerges that uses a different body shape —
 * e.g., an OpenRouter passthrough path), there's one place to branch.
 * Currently a thin pass-through; the isolation is the value, not the body
 * construction logic.
 */
export function buildVoxtralSpeechBody(opts: MistralTTSOptions): Record<string, unknown> {
  return {
    input: opts.text,
    voice_id: opts.voiceId,
    model: opts.modelId ?? 'voxtral-mini-tts-latest',
    response_format: opts.responseFormat ?? 'wav',
  };
}

/**
 * Build the JSON body for `POST /v1/audio/voices` (cloning).
 *
 * Mistral silently drops slug/languages/gender/age/tags on creation —
 * we only send `name` (the find-or-create key) and the base64 reference.
 * `sample_filename` is sent for format detection.
 */
export function buildVoxtralVoiceCreateBody(opts: MistralCloneOptions): Record<string, unknown> {
  return {
    name: opts.name,
    sample_audio: opts.audioBuffer.toString('base64'),
    sample_filename: filenameFromContentType(opts.contentType),
  };
}

/** Map common audio MIME types to a representative filename for Mistral's
 *  format-detection logic. Explicit cases for the formats current frontends
 *  produce (wav/mpeg/ogg/m4a/flac); raw PCM gets a `.pcm` extension so a
 *  PCM upload doesn't silently masquerade as WAV (PCM data lacks the
 *  44-byte RIFF header WAV expects, so a `.wav` extension would corrupt
 *  Mistral's format detection and probably error out at clone time). The
 *  fallback for genuinely unknown types stays at `.wav` since that's the
 *  most likely format-detection success for a generic audio payload. */
function filenameFromContentType(contentType: string): string {
  if (contentType.includes('mpeg')) {
    return 'reference.mp3';
  }
  if (contentType.includes('ogg')) {
    return 'reference.ogg';
  }
  if (contentType.includes('flac')) {
    return 'reference.flac';
  }
  if (contentType.includes('mp4') || contentType.includes('m4a')) {
    return 'reference.m4a';
  }
  if (contentType.includes('pcm')) {
    return 'reference.pcm';
  }
  return 'reference.wav';
}

/** Map Mistral's `response_format` to the corresponding HTTP content-type. */
function contentTypeForFormat(format: string): string {
  switch (format) {
    case 'mp3':
      return 'audio/mpeg';
    case 'opus':
      return 'audio/opus';
    case 'flac':
      return 'audio/flac';
    case 'pcm':
      return 'audio/pcm';
    case 'wav':
    default:
      return 'audio/wav';
  }
}

// ============================================================================
// HTTP plumbing
// ============================================================================

async function mistralFetch(
  endpoint: string,
  init: RequestInit & { timeoutMs?: number }
): Promise<globalThis.Response> {
  const { timeoutMs = MISTRAL_TIMEOUT_MS, ...fetchInit } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${BASE_URL}${endpoint}`, {
      ...fetchInit,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MistralTimeoutError(timeoutMs, endpoint, error);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

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
 * Synthesize speech via Mistral. Decodes the base64 `audio_data` field at
 * the boundary so callers get a raw `Buffer`.
 */
export async function mistralTTS(opts: MistralTTSOptions): Promise<MistralTTSResult> {
  const responseFormat = opts.responseFormat ?? 'wav';
  const body = buildVoxtralSpeechBody({ ...opts, responseFormat });

  const response = await mistralFetch('/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    timeoutMs: MISTRAL_TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new MistralApiError(response.status, await readResponseError(response));
  }

  const json = (await response.json()) as { audio_data?: string };
  if (typeof json.audio_data !== 'string' || json.audio_data.length === 0) {
    throw new MistralResponseShapeError('/v1/audio/speech', 'audio_data');
  }

  const audioBuffer = Buffer.from(json.audio_data, 'base64');
  logger.debug(
    { voiceId: opts.voiceId, charCount: opts.text.length, audioBytes: audioBuffer.length },
    'Mistral TTS synthesized'
  );

  return {
    audioBuffer,
    contentType: contentTypeForFormat(responseFormat),
  };
}

/**
 * Clone a voice from reference audio. Returns the `id` (UUID) Mistral assigns;
 * the `name` we sent is preserved on the server side as the cache key.
 */
export async function mistralCloneVoice(opts: MistralCloneOptions): Promise<MistralVoiceInfo> {
  const body = buildVoxtralVoiceCreateBody(opts);

  const response = await mistralFetch('/audio/voices', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    timeoutMs: MISTRAL_TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new MistralApiError(response.status, await readResponseError(response));
  }

  const json = (await response.json()) as { id?: string; name?: string; user_id?: string | null };
  if (typeof json.id !== 'string' || json.id.length === 0) {
    throw new MistralResponseShapeError('/v1/audio/voices', 'id');
  }

  logger.info({ voiceId: json.id, name: opts.name }, 'Mistral voice cloned');

  return {
    id: json.id,
    name: typeof json.name === 'string' ? json.name : opts.name,
    userId: typeof json.user_id === 'string' ? json.user_id : null,
  };
}

/** Safety cap on pagination — at page_size=50, this is 1000 voices.
 *  Beyond this, something pathological is going on (compromised account
 *  or runaway clone-bug), so the cap prevents an infinite loop on a bad
 *  Mistral response while still covering any realistic legitimate scale. */
const VOICE_LIST_MAX_PAGES = 20;

interface VoicesPage {
  items: MistralVoiceInfo[];
  totalPages: number;
}

/** Fetch a single page of the voices listing. Internal helper for the
 *  pagination walker. */
async function fetchVoicesPage(apiKey: string, page: number): Promise<VoicesPage> {
  const response = await mistralFetch(
    `/audio/voices?page=${page}&page_size=${VOICE_LIST_PAGE_SIZE}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: MISTRAL_FAST_TIMEOUT_MS,
    }
  );

  if (!response.ok) {
    throw new MistralApiError(response.status, await readResponseError(response));
  }

  const json = (await response.json()) as {
    items?: { id: string; name: string; user_id: string | null }[];
    total?: number;
    total_pages?: number;
  };
  if (!Array.isArray(json.items)) {
    throw new MistralResponseShapeError('/v1/audio/voices', 'items');
  }

  return {
    items: json.items.map(item => ({
      id: item.id,
      name: item.name,
      userId: item.user_id,
    })),
    totalPages: typeof json.total_pages === 'number' ? json.total_pages : 1,
  };
}

/**
 * List all voices in the account, walking the pagination if necessary.
 *
 * At one-voice-per-personality scale the listing usually fits in a single
 * page (page_size=50), but this walker covers accounts that grow past
 * the boundary so the find-by-name lookup in `MistralTtsProvider` doesn't
 * silently miss voices on page 2+ and trigger a duplicate clone.
 *
 * Capped at `VOICE_LIST_MAX_PAGES` pages (1000 voices) — a soft safety
 * net against a runaway pagination loop on pathological responses.
 */
export async function mistralListVoices(apiKey: string): Promise<MistralVoiceInfo[]> {
  const all: MistralVoiceInfo[] = [];
  let page = 1;

  while (page <= VOICE_LIST_MAX_PAGES) {
    const { items, totalPages } = await fetchVoicesPage(apiKey, page);
    all.push(...items);

    if (page >= totalPages) {
      return all;
    }
    page++;
  }

  logger.warn(
    { maxPages: VOICE_LIST_MAX_PAGES, returnedCount: all.length },
    'Mistral voice list pagination cap reached — possibly missing voices on later pages'
  );
  return all;
}

/**
 * Delete a cloned voice. Used by eviction logic if Mistral ever surfaces a
 * slot quota (currently undocumented per smoke test). Idempotent — 404
 * on already-deleted is swallowed by callers.
 */
export async function mistralDeleteVoice(voiceId: string, apiKey: string): Promise<void> {
  const response = await mistralFetch(`/audio/voices/${encodeURIComponent(voiceId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    timeoutMs: MISTRAL_FAST_TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new MistralApiError(response.status, await readResponseError(response));
  }

  logger.info({ voiceId }, 'Mistral voice deleted');
}
