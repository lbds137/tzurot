/**
 * Voice Reference Helper
 *
 * Fetches voice reference audio from the api-gateway.
 * Shared by ElevenLabsVoiceService (BYOK cloning) and
 * VoiceRegistrationService (self-hosted voice-engine registration).
 *
 * The /voice-references route is service-auth-protected; this helper
 * sends `X-Service-Auth: ${INTERNAL_SERVICE_SECRET}` on every request.
 * Missing secret is fail-fast — the helper throws before fetching rather
 * than letting api-gateway respond 403. The fail-fast surfaces a config
 * misconfiguration as a clear call-site error (with the right
 * environment variable named) rather than a generic 403 from the
 * gateway that's harder to attribute.
 */

import { getConfig } from '@tzurot/common-types/config/config';
import { TimeoutError } from '@tzurot/common-types/utils/errors';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('VoiceReferenceHelper');

/** Timeout for voice reference fetch (15s) — tighter than TTSStep's outer timeout
 * so the failure surfaces as a gateway fetch error rather than a generic TTS timeout. */
const VOICE_REFERENCE_TIMEOUT_MS = 15_000;

export interface VoiceReferenceResult {
  audioBuffer: Buffer;
  contentType: string;
  /**
   * Duration in seconds, parsed from the buffer's container header where
   * cheaply possible. `undefined` if the format isn't recognized — callers
   * fall back to whatever reactive validation the downstream API does.
   *
   * Currently parsed for: WAV (RIFF header). Other formats (mp3/ogg/m4a/flac)
   * would need format-specific parsers; not implemented because the only
   * caller needing duration today (`MistralTtsProvider`'s 30s pre-flight)
   * primarily sees WAV.
   */
  durationSec?: number;
}

export async function fetchVoiceReference(slug: string): Promise<VoiceReferenceResult> {
  const config = getConfig();
  const gatewayUrl = config.GATEWAY_URL;
  if (gatewayUrl === undefined) {
    throw new Error('GATEWAY_URL not configured — cannot fetch voice reference');
  }
  const serviceSecret = config.INTERNAL_SERVICE_SECRET;
  if (serviceSecret === undefined || serviceSecret.length === 0) {
    throw new Error(
      'INTERNAL_SERVICE_SECRET not configured — cannot fetch voice reference (the gateway route requires service auth)'
    );
  }

  const voiceUrl = `${gatewayUrl}/voice-references/${encodeURIComponent(slug)}`;
  logger.info({ slug }, 'Fetching voice reference from gateway');

  let response: globalThis.Response;
  try {
    response = await fetch(voiceUrl, {
      headers: { 'X-Service-Auth': serviceSecret },
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
  const durationSec = parseAudioDurationSec(audioBuffer, contentType);

  return { audioBuffer, contentType, durationSec };
}

/**
 * Best-effort duration parser. Returns `undefined` for unrecognized formats
 * rather than throwing — callers should treat duration as advisory.
 */
export function parseAudioDurationSec(
  audioBuffer: Buffer,
  contentType: string
): number | undefined {
  if (isWavBuffer(audioBuffer, contentType)) {
    return parseWavDurationSec(audioBuffer);
  }
  return undefined;
}

function isWavBuffer(audioBuffer: Buffer, contentType: string): boolean {
  if (contentType.includes('wav') || contentType.includes('wave')) {
    return true;
  }
  // Fallback: detect by RIFF/WAVE magic bytes — some servers return generic
  // 'application/octet-stream' for WAV uploads.
  return (
    audioBuffer.length >= 12 &&
    audioBuffer.toString('ascii', 0, 4) === 'RIFF' &&
    audioBuffer.toString('ascii', 8, 12) === 'WAVE'
  );
}

/**
 * Parse a WAV (RIFF/WAVE) buffer's duration in seconds.
 *
 * Walks the RIFF chunk list to find both `fmt ` (for the stored byteRate) and
 * `data` (audio bytes). Duration = `data_bytes / byteRate`. Reads the stored
 * `byteRate` field directly rather than deriving it from sampleRate × channels
 * × bytesPerSample — the derived formula is only correct for PCM
 * (audioFormat=1) and silently produces wrong durations for compressed WAV
 * formats (ADPCM, A-law, μ-law). The stored byteRate is correct for any
 * audioFormat.
 *
 * Assumes `fmt ` appears before `data` in the chunk stream — universally true
 * in practice (Mistral references, Discord exports, every standard WAV
 * encoder), but technically a non-conforming WAV could place `data` first. In
 * that case `byteRate` is missing when we hit the data-chunk break and the
 * function returns `undefined` (safe degradation; caller falls through to the
 * reactive Mistral 400 path).
 *
 * Returns `undefined` when the buffer is too short, the chunks aren't found,
 * or `byteRate === 0` — the caller proceeds without the optimization rather
 * than failing the whole TTS path on a malformed reference.
 */
function parseWavDurationSec(audioBuffer: Buffer): number | undefined {
  // RIFF header: 12 bytes ("RIFF" + chunk size + "WAVE")
  if (audioBuffer.length < 12) {
    return undefined;
  }
  if (
    audioBuffer.toString('ascii', 0, 4) !== 'RIFF' ||
    audioBuffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    return undefined;
  }

  let byteRate: number | undefined;
  let dataSize: number | undefined;

  // Walk subchunks starting at byte 12.
  let offset = 12;
  while (offset + 8 <= audioBuffer.length) {
    const chunkId = audioBuffer.toString('ascii', offset, offset + 4);
    const chunkSize = audioBuffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;

    if (chunkId === 'fmt ' && chunkSize >= 16 && dataStart + 16 <= audioBuffer.length) {
      // fmt chunk layout (PCM, 16 bytes — extended formats add fields after
      // bitsPerSample, but byteRate is at the same offset for all): audioFormat(2)
      // numChannels(2) sampleRate(4) byteRate(4) blockAlign(2) bitsPerSample(2).
      // The `chunkSize >= 16` guard prevents reading past the chunk's declared
      // bounds — a malformed WAV with `chunkSize=4` could otherwise pass the
      // buffer-length check and read garbage from the next chunk's territory.
      byteRate = audioBuffer.readUInt32LE(dataStart + 8);
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
      break; // data chunk found — stop walking
    }

    // RIFF chunks are word-aligned: pad odd sizes by 1 byte.
    offset = dataStart + chunkSize + (chunkSize % 2);
  }

  if (byteRate === undefined || dataSize === undefined || byteRate === 0) {
    return undefined;
  }

  return dataSize / byteRate;
}
