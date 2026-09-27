/**
 * Voice-attachment container sniffing.
 *
 * A Vencord/Vesktop voice message arrives with Discord's `IsVoiceMessage`
 * message flag set and the attachment's declared `content_type` set to
 * `video/webm`, with bytes that begin with the EBML header. A voice
 * recording re-uploaded as a plain file arrives with the same `video/webm`
 * label but no voice flag. The BYOK STT clients (Mistral, ElevenLabs)
 * forward the declared content type and filename to the provider, so a
 * mislabeled attachment needs relabeling to match its actual container
 * before it reaches them — this module inspects the first bytes of the
 * downloaded audio to recover the real container and relabel accordingly.
 * `ebmlHasVideoTrack` answers the separate question of whether a `video/webm`
 * container actually carries a video track, so the caller can tell an
 * audio-only upload from a real video.
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
  { bytes: [0x1a, 0x45, 0xdf, 0xa3], contentType: CONTENT_TYPES.AUDIO_WEBM, extension: '.webm' },
  // "OggS" — the Ogg container's page magic.
  { bytes: [0x4f, 0x67, 0x67, 0x53], contentType: CONTENT_TYPES.AUDIO_OGG, extension: '.ogg' },
];

/** Upper bound on the header bytes `ebmlHasVideoTrack` scans when no Cluster id appears first. */
export const EBML_HEADER_SCAN_MAX_BYTES = 256 * 1024;

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

/** The Matroska/WebM Cluster element id, marking the end of the header region. */
const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75] as const;

/** Whether `bytes` starting at `offset` match `signature`. */
function matchesAt(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * Scans from offset 0 to the first Cluster element id, capped at
 * `EBML_HEADER_SCAN_MAX_BYTES`, for a CodecID element (id `0x86`, one-byte
 * size, value starting `V_`); true on the first hit. The Segment size is not
 * consulted, because Chromium's MediaRecorder writes it as unknown
 * (`01 FF FF FF FF FF FF FF`) while live-muxing. The `V_` / `A_` codec-id
 * prefixes are spec-sourced (Matroska codec specs,
 * https://www.matroska.org/technical/codec_specs.html: video ids start `V_`,
 * audio `A_`), pinned by the Chromium MediaRecorder and ffmpeg header
 * fixtures in `voiceContainerSniff.test.ts`. Not verified against a Chromium
 * audio+video recording (headless Chrome could not produce one); the
 * has-video branch is pinned by the ffmpeg fixture only.
 */
export function ebmlHasVideoTrack(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, EBML_HEADER_SCAN_MAX_BYTES);
  for (let i = 0; i < end; i++) {
    if (matchesAt(bytes, i, CLUSTER_ID)) {
      return false;
    }
    const size = bytes[i + 1];
    if (
      bytes[i] === 0x86 &&
      size !== undefined &&
      size >= 0x82 &&
      size <= 0xa0 &&
      bytes[i + 2] === 0x56 &&
      bytes[i + 3] === 0x5f
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Replace `name`'s final extension with `extension`, or synthesize one when
 * `name` is absent/empty. Exported so AudioProcessor can build the same
 * `.ogg`-suffixed filename for a transcoded attachment.
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
 * already `audio/*`.
 *
 * Applicable when the attachment is flagged as a voice message OR declares
 * `video/webm` (a plain, unflagged upload of a voice recording arrives with
 * Discord's `video/webm` label), and the declared type does not already
 * start with `audio/`; anything else passes through unchanged with outcome
 * `not-applicable`. It labels by container magic only; whether a
 * `video/webm` actually carries a video track is `ebmlHasVideoTrack`'s
 * question, answered by the caller.
 */
export function resolveVoiceAudioLabel(
  attachment: { contentType: string; name?: string; isVoiceMessage?: boolean },
  bytes: Uint8Array
): VoiceAudioLabelResult {
  const alreadyAudio = attachment.contentType.startsWith(CONTENT_TYPES.AUDIO_PREFIX);
  const applicable =
    attachment.isVoiceMessage === true || attachment.contentType === CONTENT_TYPES.VIDEO_WEBM;
  if (!applicable || alreadyAudio) {
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
