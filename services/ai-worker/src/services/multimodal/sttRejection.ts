/**
 * Deterministic STT rejection classification.
 *
 * Shared by every retry wrapper on the transcription path (the async job and
 * both chat-attachment callers) so a rejection the voice-engine made BEFORE
 * inference — the audio is over the duration cap, or the bytes never
 * decoded — is recognised the same way everywhere. A retry re-sends the same
 * bytes to the same decision, so these two classes never benefit from one.
 */
import { isTooLongError, isUnsupportedFormatError } from '@tzurot/common-types/utils/errors';

/**
 * True when `error` is a deterministic STT rejection: {@link AudioTooLongError}
 * or {@link UnsupportedAudioFormatError}. Callers pass the raw error as thrown —
 * this does not unwrap a `RetryError` or any other wrapper.
 */
export function isDeterministicSttRejection(error: unknown): boolean {
  return isTooLongError(error) || isUnsupportedFormatError(error);
}
