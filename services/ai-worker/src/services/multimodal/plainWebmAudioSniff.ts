/**
 * A voice recording re-uploaded as a plain file arrives `video/webm` with no
 * voice flag, so the chat path would render it as an unsupported-file stub.
 * This sniffs the bytes and hands back the buffer when the WebM is
 * audio-only, so the caller can route it to STT without a second fetch.
 *
 * Kept separate from AudioProcessor to keep that module within its size
 * budget.
 */

import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { fetchAudioBuffer } from './AudioProcessor.js';
import { ebmlHasVideoTrack, resolveVoiceAudioLabel } from './voiceContainerSniff.js';

const logger = createLogger('plainWebmAudioSniff');

/**
 * Largest declared size of a plain `video/webm` upload the sniff will fetch
 * and inspect. Below voice-engine's 50 MiB `MAX_AUDIO_UPLOAD_BYTES`
 * (`services/voice-engine/server.py`), so a routed file stays within the STT
 * upload cap. In the chat path `DownloadAttachmentsStep` has already
 * materialized the bytes as a `data:` URL under its own per-attachment cap,
 * so there it bounds the decode; for a caller holding a network URL it also
 * bounds the bytes downloaded only to be discarded when the file turns out
 * to carry a video track. An attachment with no declared `size` is not
 * sniffed.
 */
export const PLAIN_WEBM_SNIFF_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Gate: only a plain (non-voice-flagged) `video/webm` attachment within the
 * size cap is fetched at all — anything else returns `null` with no
 * network call. On the gate passing, fetches the bytes; a fetch failure
 * logs a warn and returns `null` so the caller falls back to the file stub.
 * The EBML check goes through `resolveVoiceAudioLabel` so the bytes it
 * approves are exactly the ones `transcribeAudio`'s prepare step will
 * relabel `audio/webm` and transcode — returns the fetched buffer when the
 * container is EBML with no video track, `null` otherwise.
 */
export async function sniffPlainWebmForAudioOnly(
  attachment: AttachmentMetadata
): Promise<ArrayBuffer | null> {
  if (
    attachment.contentType !== CONTENT_TYPES.VIDEO_WEBM ||
    attachment.isVoiceMessage === true ||
    (attachment.size ?? Infinity) > PLAIN_WEBM_SNIFF_MAX_BYTES
  ) {
    return null;
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await fetchAudioBuffer(attachment.url);
  } catch (error) {
    logger.warn(
      { err: error, name: attachment.name },
      'Plain WebM sniff fetch failed; keeping the file stub'
    );
    return null;
  }

  const bytes = new Uint8Array(buffer);
  const label = resolveVoiceAudioLabel(attachment, bytes);
  const isEbml = label.outcome === 'relabeled' && label.contentType === CONTENT_TYPES.AUDIO_WEBM;
  return isEbml && !ebmlHasVideoTrack(bytes) ? buffer : null;
}
