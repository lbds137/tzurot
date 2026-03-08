/**
 * Voice Registration Service
 *
 * Handles lazy voice registration with the voice-engine service.
 * On first TTS request for a personality, fetches the reference audio from
 * api-gateway and registers it with the voice engine. Caches registration
 * status in-memory (TTLCache, 30 min) to avoid redundant registration calls.
 */

import { createLogger, TTLCache, getConfig } from '@tzurot/common-types';
import type { VoiceEngineClient } from './VoiceEngineClient.js';

const logger = createLogger('VoiceRegistrationService');

/** TTL for registration cache entries (30 minutes) */
const REGISTRATION_CACHE_TTL_MS = 30 * 60 * 1000;
/** Max number of cached registration statuses */
const REGISTRATION_CACHE_MAX_SIZE = 200;

export class VoiceRegistrationService {
  private readonly registrationCache: TTLCache<boolean>;
  /** In-flight registration promises to prevent concurrent duplicate registrations */
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(private readonly voiceEngineClient: VoiceEngineClient) {
    this.registrationCache = new TTLCache<boolean>({
      ttl: REGISTRATION_CACHE_TTL_MS,
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
    // Check cache
    if (this.registrationCache.get(slug) === true) {
      return;
    }

    // Deduplicate concurrent registration attempts for the same slug
    const existing = this.inflight.get(slug);
    if (existing !== undefined) {
      return existing;
    }

    const promise = this.doRegister(slug).finally(() => this.inflight.delete(slug));
    this.inflight.set(slug, promise);
    return promise;
  }

  private async doRegister(slug: string): Promise<void> {
    // Check if already registered on the voice-engine
    try {
      const voices = await this.voiceEngineClient.listVoices();
      if (voices.includes(slug)) {
        this.registrationCache.set(slug, true);
        return;
      }
    } catch (error) {
      logger.warn({ err: error, slug }, 'Failed to list voices, attempting registration');
    }

    // Fetch reference audio from api-gateway
    const config = getConfig();
    const gatewayUrl = config.GATEWAY_URL;
    if (gatewayUrl === undefined) {
      throw new Error('GATEWAY_URL not configured — cannot fetch voice reference');
    }

    const voiceUrl = `${gatewayUrl}/voices/${encodeURIComponent(slug)}`;
    logger.info({ slug }, 'Fetching voice reference from gateway');

    const response = await fetch(voiceUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch voice reference for "${slug}": ${response.status} ${response.statusText}`
      );
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') ?? 'audio/wav';

    // Register with voice-engine
    logger.info({ slug, audioSize: audioBuffer.length }, 'Registering voice with voice-engine');
    await this.voiceEngineClient.registerVoice(slug, audioBuffer, contentType);

    this.registrationCache.set(slug, true);
    logger.info({ slug }, 'Voice registered successfully');
  }

  /** Clear registration cache (for testing). */
  clearCache(): void {
    this.registrationCache.clear();
  }
}
