/**
 * Voice Engine Client
 *
 * HTTP client for the self-hosted voice-engine service (Parakeet TDT STT + Pocket TTS).
 * Uses the native /v1/transcribe endpoint (richer metadata than OpenAI-compatible).
 */

import { createLogger, getConfig, TIMEOUTS } from '@tzurot/common-types';

const logger = createLogger('VoiceEngineClient');

export interface TranscriptionResult {
  text: string;
}

export interface SynthesisResult {
  audioBuffer: Buffer;
  contentType: string;
}

/** Error from voice-engine HTTP responses (carries status code for caller inspection). */
export class VoiceEngineError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`Voice engine request failed (${status}): ${detail}`);
    this.name = 'VoiceEngineError';
    this.status = status;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export class VoiceEngineClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, apiKey?: string, timeoutMs?: number) {
    // Strip trailing slash for consistent URL construction
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    // Reuses WHISPER_API timeout (3min) intentionally — Railway Serverless cold starts
    // take 30-120s for model loading, so a shorter timeout would cause false failures.
    this.timeoutMs = timeoutMs ?? TIMEOUTS.WHISPER_API;
  }

  /** Transcribe audio via POST /v1/transcribe (native endpoint). */
  async transcribe(
    audioBuffer: Buffer,
    filename: string,
    contentType: string
  ): Promise<TranscriptionResult> {
    const formData = new FormData();
    // Uint8Array wrapper needed — Buffer isn't assignable to BlobPart in strict TS
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: contentType });
    formData.append('file', blob, filename);

    const response = await this.fetchWithTimeout('/v1/transcribe', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const detail = await this.extractErrorDetail(response);
      throw new VoiceEngineError(response.status, detail);
    }

    return (await response.json()) as TranscriptionResult;
  }

  /**
   * Check service health via GET /health. Returns true only when both ASR and TTS
   * models are loaded ("fully ready"). For STT-only checks, use
   * `getHealth().then(h => h.asr)` instead — this method will return false during
   * TTS cold-start even if ASR is already available.
   *
   * @see {@link getHealth} for per-model status without collapsing to a single boolean
   */
  async isHealthy(): Promise<boolean> {
    const health = await this.getHealth();
    return health.asr && health.tts;
  }

  /** Get per-model health status. Returns `{ asr: false, tts: false }` on any error. */
  async getHealth(): Promise<{ asr: boolean; tts: boolean }> {
    try {
      const response = await this.fetchWithTimeout('/health', { method: 'GET' }, 5_000);
      if (!response.ok) {
        return { asr: false, tts: false };
      }
      const body = (await response.json()) as { asr_loaded?: boolean; tts_loaded?: boolean };
      return {
        asr: body.asr_loaded === true,
        tts: body.tts_loaded === true,
      };
    } catch {
      return { asr: false, tts: false };
    }
  }

  /** Synthesize speech via POST /v1/tts.
   *  No explicit timeout — inherits `this.timeoutMs` (3 min) to accommodate
   *  Railway Serverless cold starts. See constructor comment for rationale. */
  async synthesize(text: string, voiceId: string): Promise<SynthesisResult> {
    const formData = new FormData();
    formData.append('text', text);
    formData.append('voice_id', voiceId);

    const response = await this.fetchWithTimeout('/v1/tts', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const detail = await this.extractErrorDetail(response);
      throw new VoiceEngineError(response.status, detail);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      audioBuffer: Buffer.from(arrayBuffer),
      contentType: response.headers.get('content-type') ?? 'audio/wav',
    };
  }

  /** Register a voice via POST /v1/voices/register. */
  async registerVoice(voiceId: string, audioBuffer: Buffer, contentType: string): Promise<void> {
    const formData = new FormData();
    formData.append('voice_id', voiceId);
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: contentType });
    // Extension is for the multipart filename hint only — voice-engine reads the actual
    // audio format from the Content-Type header, not the file extension.
    formData.append('audio', blob, `${voiceId}.wav`);

    const response = await this.fetchWithTimeout('/v1/voices/register', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const detail = await this.extractErrorDetail(response);
      throw new VoiceEngineError(response.status, detail);
    }
  }

  /** List registered voices via GET /v1/voices. */
  async listVoices(): Promise<string[]> {
    const response = await this.fetchWithTimeout('/v1/voices', { method: 'GET' }, 10_000);

    if (!response.ok) {
      const detail = await this.extractErrorDetail(response);
      throw new VoiceEngineError(response.status, detail);
    }

    const body = (await response.json()) as { voices: { id: string }[] };
    return body.voices.map(v => v.id);
  }

  private async fetchWithTimeout(
    path: string,
    init: RequestInit,
    timeoutOverride?: number
  ): Promise<globalThis.Response> {
    const controller = new AbortController();
    const effectiveTimeout = timeoutOverride ?? this.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), effectiveTimeout);

    const headers: Record<string, string> = {};
    if (this.apiKey !== undefined) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...headers,
          ...(init.headers !== undefined
            ? Object.fromEntries(new Headers(init.headers).entries())
            : {}),
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Voice engine request timed out after ${effectiveTimeout}ms`, {
          cause: error,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async extractErrorDetail(response: globalThis.Response): Promise<string> {
    try {
      const body = (await response.json()) as { detail?: string };
      return body.detail ?? response.statusText;
    } catch {
      return response.statusText;
    }
  }
}

// ---------------------------------------------------------------------------
// Lazy singleton — created from config on first access
// ---------------------------------------------------------------------------
let _instance: VoiceEngineClient | null = null;
let _checked = false;

/**
 * Get the VoiceEngineClient singleton (or null if VOICE_ENGINE_URL is not configured).
 * Config is read once at first call and cached — subsequent calls return the same result.
 * This matches Railway's restart-on-env-change model (process restarts on config changes).
 */
export function getVoiceEngineClient(): VoiceEngineClient | null {
  if (_checked) {
    return _instance;
  }

  const config = getConfig();
  _checked = true;

  if (config.VOICE_ENGINE_URL === undefined) {
    return null;
  }

  _instance = new VoiceEngineClient(config.VOICE_ENGINE_URL, config.VOICE_ENGINE_API_KEY);
  logger.info({ url: config.VOICE_ENGINE_URL }, 'Voice engine client initialized');
  return _instance;
}

/** Reset singleton (for testing). */
export function resetVoiceEngineClient(): void {
  _instance = null;
  _checked = false;
}
