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

import { createLogger, AI_ENDPOINTS } from '@tzurot/common-types';

const logger = createLogger('ElevenLabsClient');

const BASE_URL = AI_ENDPOINTS.ELEVENLABS_BASE_URL;

/** Timeout for ElevenLabs API calls (60s — TTS can be slow for long text) */
const ELEVENLABS_TIMEOUT_MS = 60_000;

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

/** Error from ElevenLabs HTTP responses (carries status code for caller inspection). */
export class ElevenLabsApiError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`ElevenLabs API error (${status}): ${detail}`);
    this.name = 'ElevenLabsApiError';
    this.status = status;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
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
        'xi-api-key': apiKey,
        ...(init.headers !== undefined
          ? Object.fromEntries(new Headers(init.headers).entries())
          : {}),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`ElevenLabs request timed out after ${timeoutMs}ms`, { cause: error });
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
 * Synthesize speech via ElevenLabs TTS.
 *
 * Returns MP3 audio (~10x smaller than WAV from voice-engine).
 */
export async function elevenLabsTTS(options: ElevenLabsTTSOptions): Promise<ElevenLabsTTSResult> {
  const { text, voiceId, apiKey, modelId = 'eleven_multilingual_v2' } = options;

  // SSRF prevention: encode voiceId in URL path
  const response = await elevenLabsFetch(`/text-to-speech/${encodeURIComponent(voiceId)}`, apiKey, {
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

  const arrayBuffer = await response.arrayBuffer();
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

  const response = await elevenLabsFetch('/speech-to-text', apiKey, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const detail = await extractErrorDetail(response);
    throw new ElevenLabsApiError(response.status, detail);
  }

  const data = (await response.json()) as { text?: string };
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
  formData.append('files', blob, `${name}.wav`);
  if (description !== undefined) {
    formData.append('description', description);
  }

  const response = await elevenLabsFetch('/voices/add', apiKey, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const detail = await extractErrorDetail(response);
    throw new ElevenLabsApiError(response.status, detail);
  }

  const data = (await response.json()) as { voice_id?: string };
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
  const response = await elevenLabsFetch('/voices', apiKey, { method: 'GET' }, 15_000);

  if (!response.ok) {
    const detail = await extractErrorDetail(response);
    throw new ElevenLabsApiError(response.status, detail);
  }

  const data = (await response.json()) as { voices?: { voice_id: string; name: string }[] };
  return (data.voices ?? []).map(v => ({ voiceId: v.voice_id, name: v.name }));
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
    15_000
  );

  if (!response.ok) {
    const detail = await extractErrorDetail(response);
    throw new ElevenLabsApiError(response.status, detail);
  }

  logger.info({ voiceId }, 'Voice deleted from ElevenLabs');
}
