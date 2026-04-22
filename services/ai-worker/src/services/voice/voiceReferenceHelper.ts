/**
 * Voice Reference Helper
 *
 * Fetches voice reference audio from the api-gateway.
 * Shared by ElevenLabsVoiceService (BYOK cloning) and
 * VoiceRegistrationService (self-hosted voice-engine registration).
 */

import { createLogger, getConfig, TimeoutError } from '@tzurot/common-types';

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

  let response: globalThis.Response;
  try {
    response = await fetch(voiceUrl, {
      signal: AbortSignal.timeout(VOICE_REFERENCE_TIMEOUT_MS),
    });
  } catch (error) {
    // AbortSignal.timeout() throws a DOMException with name 'TimeoutError' — that's
    // the Web API sentinel, not our custom TimeoutError. Detect by name string, then
    // re-throw as our typed sentinel so callers can use instanceof.
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new TimeoutError(
        VOICE_REFERENCE_TIMEOUT_MS,
        `voice reference fetch for "${slug}"`,
        error
      );
    }
    throw error;
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
