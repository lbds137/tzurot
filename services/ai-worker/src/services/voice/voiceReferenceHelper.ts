/**
 * Voice Reference Helper
 *
 * Fetches voice reference audio from the api-gateway.
 * Shared by ElevenLabsVoiceService (BYOK cloning) and
 * VoiceRegistrationService (self-hosted voice-engine registration).
 */

import { createLogger, getConfig } from '@tzurot/common-types';

const logger = createLogger('VoiceReferenceHelper');

/** Timeout for voice reference fetch (15s) — tighter than TTSStep's outer timeout
 * so the failure surfaces as a gateway fetch error rather than a generic TTS timeout. */
const VOICE_REFERENCE_TIMEOUT_MS = 15_000;

export interface VoiceReferenceResult {
  audioBuffer: Buffer;
  contentType: string;
}

export async function fetchVoiceReference(slug: string): Promise<VoiceReferenceResult> {
  const config = getConfig();
  const gatewayUrl = config.GATEWAY_URL;
  if (gatewayUrl === undefined) {
    throw new Error('GATEWAY_URL not configured — cannot fetch voice reference');
  }

  const voiceUrl = `${gatewayUrl}/voice-references/${encodeURIComponent(slug)}`;
  logger.info({ slug }, 'Fetching voice reference from gateway');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOICE_REFERENCE_TIMEOUT_MS);
  let response: globalThis.Response;
  try {
    response = await fetch(voiceUrl, { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Gateway fetch timed out for voice reference "${slug}"`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch voice reference for "${slug}": ${response.status} ${response.statusText}`
    );
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? 'audio/wav';

  return { audioBuffer, contentType };
}
