/**
 * ElevenLabs Client
 *
 * Stateless HTTP functions for the ElevenLabs API. Unlike VoiceEngineClient
 * (singleton, shared base URL), each call takes an API key — different users
 * have different keys (BYOK).
 *
 * Endpoints used:
 * - POST /v1/text-to-speech/{voice_id} — TTS synthesis
 * - POST /v1/speech-to-text — STT transcription
 * - POST /v1/voices/add — Voice cloning (from reference audio)
 * - GET  /v1/voices — List voices in account
 * - DELETE /v1/voices/{voice_id} — Delete a cloned voice
 */

import { createLogger, AI_ENDPOINTS, TimeoutError } from '@tzurot/common-types';

const logger = createLogger('ElevenLabsClient');

const BASE_URL = AI_ENDPOINTS.ELEVENLABS_BASE_URL;

/** Timeout for ElevenLabs API calls (60s — TTS can be slow for long text) */
const ELEVENLABS_TIMEOUT_MS = 60_000;
/** Shorter timeout for lightweight operations (list voices, delete voice) */
const ELEVENLABS_FAST_TIMEOUT_MS = 15_000;

export interface ElevenLabsTTSOptions {
  text: string;
  voiceId: string;
  apiKey: string;
  /** Model ID (defaults to eleven_multilingual_v2) */
  modelId?: string;
}

export interface ElevenLabsTTSResult {
  audioBuffer: Buffer;
  contentType: string;
}

export interface ElevenLabsSTTOptions {
  audioBuffer: Buffer;
  filename: string;
  contentType: string;
  apiKey: string;
}

export interface ElevenLabsSTTResult {
  text: string;
}

export interface ElevenLabsCloneOptions {
  name: string;
  audioBuffer: Buffer;
  contentType: string;
  apiKey: string;
  /** Optional description for the cloned voice */
  description?: string;
}

export interface ElevenLabsVoiceInfo {
  voiceId: string;
  name: string;
}

export interface ElevenLabsModelInfo {
  modelId: string;
  name: string;
}

/** Error thrown when an ElevenLabs API call times out (AbortController fires).
 * Typed sentinel replaces fragile message-string matching in retry logic.
 * Includes the endpoint path for actionable production logs (e.g.,
 * "ElevenLabs /text-to-speech/abc123 timed out after 60000ms"). */
export class ElevenLabsTimeoutError extends TimeoutError {
  constructor(timeoutMs: number, endpoint: string, cause: Error) {
    super(timeoutMs, `ElevenLabs ${endpoint}`, cause);
    this.name = 'ElevenLabsTimeoutError';
  }
}

/** Error from ElevenLabs HTTP responses (carries status code for caller inspection). */
export class ElevenLabsApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`ElevenLabs API error (${status}): ${detail}`);
    this.name = 'ElevenLabsApiError';
    this.status = status;
    this.detail = detail;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** True for transient errors worth retrying: 429 rate limit, 5xx server errors.
   * Does NOT include 404 (handled separately by re-clone logic). */
  get isTransient(): boolean {
    return this.isRateLimited || this.status >= 500;
  }

  /** True when ElevenLabs rejects voice creation due to account voice slot limit.
   * Conservative pattern — if the message format changes, the error propagates
   * to the outer ensureVoiceCloned catch (no eviction attempted, no regression).
   *
   * Only checks 400/422 — ElevenLabs may return 403 for subscription-level
   * limits, but we haven't observed that for voice slot exhaustion specifically.
   * If 403 voice-limit errors appear in production logs, add it here. */
  get isVoiceLimitError(): boolean {
    if (this.status !== 400 && this.status !== 422) {
      return false;
    }
    return /maximum.*voice|voice.*limit|too many voices/i.test(this.detail);
  }
}

/**
 * Shared fetch wrapper with timeout and xi-api-key header.
 */
async function elevenLabsFetch(
  path: string,
  apiKey: string,
  init: RequestInit,
  timeoutMs = ELEVENLABS_TIMEOUT_MS
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.headers !== undefined
          ? Object.fromEntries(new Headers(init.headers).entries())
          : {}),
        'xi-api-key': apiKey, // after spread — apiKey always wins
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ElevenLabsTimeoutError(timeoutMs, path, error);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extract error detail from an ElevenLabs error response.
 */
async function extractErrorDetail(response: globalThis.Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: { message?: string } | string };
    if (typeof body.detail === 'string') {
      return body.detail;
    }
    if (typeof body.detail === 'object' && body.detail?.message !== undefined) {
      return body.detail.message;
    }
    return response.statusText;
  } catch {
    return response.statusText;
  }
}

/**
 * Read response body with AbortError → ElevenLabsTimeoutError conversion.
 *
 * The fetch signal remains attached to the response stream, so an abort
 * during body consumption (arrayBuffer, json) throws a raw AbortError.
 * This wrapper catches it and converts to the same typed timeout error
 * that elevenLabsFetch uses for fetch-phase aborts.
 */
async function readBody<T>(
  response: globalThis.Response,
  reader: (r: globalThis.Response) => Promise<T>,
  timeoutMs: number,
  path: string
): Promise<T> {
  try {
    return await reader(response);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ElevenLabsTimeoutError(timeoutMs, path, error);
    }
    throw error;
  }
}

/**
 * Synthesize speech via ElevenLabs TTS.
 *
 * Returns MP3 audio (~10x smaller than WAV from voice-engine).
 */
export async function elevenLabsTTS(options: ElevenLabsTTSOptions): Promise<ElevenLabsTTSResult> {
  // Default matches HARDCODED_CONFIG_DEFAULTS.elevenlabsTtsModel in configOverrides.ts.
  // In practice, TTSStep always passes an explicit modelId from the resolved config cascade,
  // so this default is a safety net for direct callers only.
  const { text, voiceId, apiKey, modelId = 'eleven_multilingual_v2' } = options;

  // SSRF prevention: encode voiceId in URL path
  const path = `/text-to-speech/${encodeURIComponent(voiceId)}`;
  const response = await elevenLabsFetch(path, apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: modelId,
    }),
  });

  if (!response.ok) {
    const detail = await extractErrorDetail(response);
    throw new ElevenLabsApiError(response.status, detail);
  }

  const arrayBuffer = await readBody(response, r => r.arrayBuffer(), ELEVENLABS_TIMEOUT_MS, path);
  return {
    audioBuffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') ?? 'audio/mpeg',
  };
}

/**
 * Transcribe audio via ElevenLabs STT.
 */
export async function elevenLabsSTT(options: ElevenLabsSTTOptions): Promise<ElevenLabsSTTResult> {
  const { audioBuffer, filename, contentType, apiKey } = options;

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: contentType });
  formData.append('file', blob, filename);
  // Pin model to avoid silent behavior changes if ElevenLabs changes their default.
  // Upgrade to 'scribe_v2' when audio event tags ([laughter], [sigh]) support is added.
  formData.append('model_id', 'scribe_v1');

  const path = '/speech-to-text';
  const response = await elevenLabsFetch(path, apiKey, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const detail = await extractErrorDetail(response);
    throw new ElevenLabsApiError(response.status, detail);
  }

  const data = await readBody(
    response,
    async r => (await r.json()) as { text?: string },
    ELEVENLABS_TIMEOUT_MS,
    path
  );
  return { text: data.text ?? '' };
}

/**
 * Clone a voice from reference audio.
 *
 * Creates an "Instant Voice Clone" using the provided audio sample.
 * Voice name is prefixed with "tzurot-" for identification in the
 * user's ElevenLabs dashboard.
 *
 * @returns The voice ID of the cloned voice
 */
export async function elevenLabsCloneVoice(
  options: ElevenLabsCloneOptions
): Promise<{ voiceId: string }> {
  const { name, audioBuffer, contentType, apiKey, description } = options;

  const formData = new FormData();
  formData.append('name', name);
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: contentType });
  // Derive extension from content type — ElevenLabs may use filename as decoding hint
  const ext = contentType.includes('mpeg') || contentType.includes('mp3') ? 'mp3' : 'wav';
  formData.append('files', blob, `${name}.${ext}`);
  if (description !== undefined) {
    formData.append('description', description);
  }

  const path = '/voices/add';
  const response = await elevenLabsFetch(path, apiKey, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const detail = await extractErrorDetail(response);
    throw new ElevenLabsApiError(response.status, detail);
  }

  const data = await readBody(
    response,
    async r => (await r.json()) as { voice_id?: string },
    ELEVENLABS_TIMEOUT_MS,
    path
  );
  if (data.voice_id === undefined) {
    throw new Error('ElevenLabs voice clone response missing voice_id');
  }

  logger.info({ voiceName: name, voiceId: data.voice_id }, 'Voice cloned via ElevenLabs');
  return { voiceId: data.voice_id };
}

/**
 * List voices in the user's ElevenLabs account.
 */
export async function elevenLabsListVoices(apiKey: string): Promise<ElevenLabsVoiceInfo[]> {
  const path = '/voices';
  const response = await elevenLabsFetch(
    path,
    apiKey,
    { method: 'GET' },
    ELEVENLABS_FAST_TIMEOUT_MS
  );

  if (!response.ok) {
    const detail = await extractErrorDetail(response);
    throw new ElevenLabsApiError(response.status, detail);
  }

  const data = await readBody(
    response,
    async r => (await r.json()) as { voices?: { voice_id: string; name: string }[] },
    ELEVENLABS_FAST_TIMEOUT_MS,
    path
  );
  return (data.voices ?? []).map(v => ({ voiceId: v.voice_id, name: v.name }));
}

/**
 * List available TTS models from ElevenLabs, filtered to those supporting text-to-speech.
 *
 * NOTE: api-gateway has a parallel implementation in routes/user/voiceModels.ts that
 * fetches and filters models the same way (can_do_text_to_speech === true). If the
 * filter logic changes, update both places. Validation differs by design: this path
 * uses manual Array.isArray() and returns [] on unexpected shapes (silent degradation),
 * while api-gateway uses Zod and surfaces parse failures as 500 errors to the caller.
 */
export async function elevenLabsListModels(apiKey: string): Promise<ElevenLabsModelInfo[]> {
  const path = '/models';
  const response = await elevenLabsFetch(
    path,
    apiKey,
    { method: 'GET' },
    ELEVENLABS_FAST_TIMEOUT_MS
  );

  if (!response.ok) {
    const detail = await extractErrorDetail(response);
    throw new ElevenLabsApiError(response.status, detail);
  }

  const data = await readBody(
    response,
    async r =>
      (await r.json()) as { model_id?: string; name?: string; can_do_text_to_speech?: boolean }[],
    ELEVENLABS_FAST_TIMEOUT_MS,
    path
  );

  // ElevenLabs /v1/models returns a top-level array of model objects
  return (Array.isArray(data) ? data : [])
    .filter(m => m.can_do_text_to_speech === true)
    .map(m => ({ modelId: m.model_id ?? '', name: m.name ?? '' }))
    .filter(m => m.modelId.length > 0);
}

/**
 * Delete a voice from the user's ElevenLabs account.
 */
export async function elevenLabsDeleteVoice(voiceId: string, apiKey: string): Promise<void> {
  // SSRF prevention: encode voiceId in URL path
  const response = await elevenLabsFetch(
    `/voices/${encodeURIComponent(voiceId)}`,
    apiKey,
    { method: 'DELETE' },
    ELEVENLABS_FAST_TIMEOUT_MS
  );

  if (!response.ok) {
    const detail = await extractErrorDetail(response);
    throw new ElevenLabsApiError(response.status, detail);
  }

  logger.info({ voiceId }, 'Voice deleted from ElevenLabs');
}
