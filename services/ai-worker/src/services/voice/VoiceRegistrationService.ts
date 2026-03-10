/**
 * Voice Registration Service
 *
 * Handles lazy voice registration with the voice-engine service.
 * On first TTS request for a personality, fetches the reference audio from
 * api-gateway and registers it with the voice engine. Caches registration
 * status in-memory (TTLCache, 30 min) to avoid redundant registration calls.
 */

import { createLogger, TTLCache } from '@tzurot/common-types';
import { VoiceEngineError } from './VoiceEngineClient.js';
import type { VoiceEngineClient } from './VoiceEngineClient.js';
import { fetchVoiceReference } from './voiceReferenceHelper.js';

const logger = createLogger('VoiceRegistrationService');

/** TTL for successful registration cache entries (30 minutes) */
const REGISTRATION_CACHE_TTL_MS = 30 * 60 * 1000;
/** TTL for failed registration cache entries (5 minutes) — suppresses retry storms
 * when a personality has a misconfigured voice reference (404, bad audio, etc.) */
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Connection error codes that indicate the voice engine is unreachable (cold start,
 * sleeping, network issue). These are transient — NOT negatively cached, so the next
 * TTS request retries immediately instead of waiting 5 minutes.
 */
const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
]);
/** Max number of cached registration statuses */
const REGISTRATION_CACHE_MAX_SIZE = 200;

export class VoiceRegistrationService {
  private readonly registrationCache: TTLCache<boolean>;
  /** Negative cache — suppresses retries for slugs with known failures (404, timeout) */
  private readonly negativeCache: TTLCache<string>;
  /** In-flight registration promises to prevent concurrent duplicate registrations */
  private readonly inflight = new Map<string, Promise<void>>();

  /** The underlying voice engine client (exposed for callers that need both services). */
  readonly client: VoiceEngineClient;

  constructor(voiceEngineClient: VoiceEngineClient) {
    this.client = voiceEngineClient;
    this.registrationCache = new TTLCache<boolean>({
      ttl: REGISTRATION_CACHE_TTL_MS,
      maxSize: REGISTRATION_CACHE_MAX_SIZE,
    });
    this.negativeCache = new TTLCache<string>({
      ttl: NEGATIVE_CACHE_TTL_MS,
      maxSize: REGISTRATION_CACHE_MAX_SIZE,
    });
  }

  /**
   * Ensure a voice is registered with the voice-engine service.
   * Checks cache first, deduplicates concurrent calls for the same slug,
   * then queries voice-engine and registers if needed.
   *
   * @throws Error if voice reference cannot be fetched or registration fails
   */
  async ensureVoiceRegistered(slug: string): Promise<void> {
    // Check positive cache
    if (this.registrationCache.get(slug) === true) {
      return;
    }

    // Check negative cache — avoid retrying known failures
    const failReason = this.negativeCache.get(slug);
    if (failReason !== null) {
      throw new Error(`Voice registration for "${slug}" recently failed: ${failReason}`);
    }

    // Deduplicate concurrent registration attempts for the same slug
    const existing = this.inflight.get(slug);
    if (existing !== undefined) {
      return existing;
    }

    const promise = this.doRegister(slug)
      .catch(error => {
        const reason = error instanceof Error ? error.message : String(error);

        // Transient errors (connection failures, 502/503) indicate cold start or
        // sleeping service — don't negatively cache so the next request retries immediately.
        if (isConnectionError(error) || isTransientServiceError(error)) {
          logger.warn({ slug, reason }, 'Voice registration failed (transient error — not cached)');
        } else {
          this.negativeCache.set(slug, reason);
          logger.warn({ slug, reason }, 'Voice registration failed — cached for 5 min');
        }

        throw error; // Re-throw so TTSStep sees the error
      })
      .finally(() => this.inflight.delete(slug));
    this.inflight.set(slug, promise);
    return promise;
  }

  private async doRegister(slug: string): Promise<void> {
    // Check if already registered on the voice-engine
    try {
      const voices = await this.client.listVoices();
      if (voices.includes(slug)) {
        this.registrationCache.set(slug, true);
        return;
      }
    } catch (error) {
      logger.warn({ err: error, slug }, 'Failed to list voices, attempting registration');
    }

    // Fetch reference audio from api-gateway
    const { audioBuffer, contentType } = await fetchVoiceReference(slug);

    // Register with voice-engine
    logger.info({ slug, audioSize: audioBuffer.length }, 'Registering voice with voice-engine');
    await this.client.registerVoice(slug, audioBuffer, contentType);

    this.registrationCache.set(slug, true);
    logger.info({ slug }, 'Voice registered successfully');
  }

  /** Clear registration caches (for testing). */
  clearCache(): void {
    this.registrationCache.clear();
    this.negativeCache.clear();
  }
}

/**
 * Check if an error is a transient HTTP service error (502/503/504).
 * - 502: Railway load balancer is up but the app hasn't bound its port yet
 * - 503: Voice engine HTTP server is up but models haven't finished loading
 * - 504: Railway load balancer timeout during slow boot
 * None should be negatively cached — the next request should retry immediately.
 */
function isTransientServiceError(error: unknown): boolean {
  if (!(error instanceof VoiceEngineError)) {
    return false;
  }
  return error.status === 502 || error.status === 503 || error.status === 504;
}

/**
 * Check if an error is a transient connection failure (ECONNREFUSED, etc.).
 * These errors indicate the service is unreachable (e.g., Railway Serverless cold start)
 * and should NOT be negatively cached — the next request should retry immediately.
 */
function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  // Node.js network errors have a `code` property (e.g., ECONNREFUSED)
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== undefined && CONNECTION_ERROR_CODES.has(code)) {
    return true;
  }
  // fetch() wraps connection errors — check the cause chain
  if (error.cause !== undefined) {
    return isConnectionError(error.cause);
  }
  // undici/node-fetch sometimes puts the code in the message.
  // Exact match on 'fetch failed' avoids false positives from unrelated error messages.
  return error.message.includes('ECONNREFUSED') || error.message === 'fetch failed';
}
