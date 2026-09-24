/**
 * Voice-attachment container sniffing.
 *
 * A Vencord/Vesktop voice message arrives with Discord's `IsVoiceMessage`
 * message flag set and the attachment's declared `content_type` set to
 * `video/webm`, with bytes that begin with the EBML header. The BYOK STT
 * clients (Mistral, ElevenLabs) forward the declared content type and
 * filename to the provider, so a mislabeled attachment needs relabeling to
 * match its actual container before it reaches them — this module inspects
 * the first bytes of the downloaded audio to recover the real container and
 * relabel accordingly.
 *
 * Pure module, no logger: the caller (AudioProcessor) decides what and how
 * to log for each outcome.
 */

import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';

/** Recognized container magic-byte signatures, checked against the start of the buffer. */
const CONTAINER_SIGNATURES: readonly {
  readonly bytes: readonly number[];
  readonly contentType: string;
  readonly extension: string;
}[] = [
  // EBML — the container format WebM (and Matroska) is built on.
  { bytes: [0x1a, 0x45, 0xdf, 0xa3], contentType: 'audio/webm', extension: '.webm' },
  // "OggS" — the Ogg container's page magic.
  { bytes: [0x4f, 0x67, 0x67, 0x53], contentType: 'audio/ogg', extension: '.ogg' },
];

/** Outcome of a `resolveVoiceAudioLabel` call, for the caller's logging decision. */
export type VoiceAudioLabelOutcome = 'not-applicable' | 'relabeled' | 'unrecognized';

export interface VoiceAudioLabelResult {
  contentType: string;
  name: string | undefined;
  outcome: VoiceAudioLabelOutcome;
}

/** Whether `bytes` starts with `signature`. */
function startsWithSignature(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * Replace `name`'s final extension with `extension`, or synthesize one when
 * `name` is absent/empty. Exported so AudioProcessor can build the same
 * `.ogg`-suffixed filename for a remuxed attachment.
 */
export function withAudioExtension(name: string | undefined, extension: string): string {
  if (name === undefined || name.length === 0) {
    return `audio${extension}`;
  }
  const lastDot = name.lastIndexOf('.');
  const base = lastDot > 0 ? name.slice(0, lastDot) : name;
  return `${base}${extension}`;
}

/**
 * Resolve the effective content type and filename for a voice attachment,
 * sniffing the container from its bytes when the declared content type isn't
 * already `audio/*` and the attachment is flagged as a voice message.
 *
 * Only applicable when `attachment.isVoiceMessage === true` AND the declared
 * content type doesn't start with `audio/` — an ordinary (non-voice) upload,
 * or one already labeled audio, passes through unchanged with outcome
 * `not-applicable`.
 */
export function resolveVoiceAudioLabel(
  attachment: { contentType: string; name?: string; isVoiceMessage?: boolean },
  bytes: Uint8Array
): VoiceAudioLabelResult {
  const alreadyAudio = attachment.contentType.startsWith(CONTENT_TYPES.AUDIO_PREFIX);
  if (attachment.isVoiceMessage !== true || alreadyAudio) {
    return {
      contentType: attachment.contentType,
      name: attachment.name,
      outcome: 'not-applicable',
    };
  }

  const match = CONTAINER_SIGNATURES.find(signature => startsWithSignature(bytes, signature.bytes));
  if (match === undefined) {
    return { contentType: attachment.contentType, name: attachment.name, outcome: 'unrecognized' };
  }

  return {
    contentType: match.contentType,
    name: withAudioExtension(attachment.name, match.extension),
    outcome: 'relabeled',
  };
}
