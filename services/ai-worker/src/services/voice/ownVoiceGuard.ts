/**
 * Own-Persona-Voice Guard — render side
 *
 * What renders in place of a persona's own voice attachment's transcript.
 * The "is this our own voice" predicate itself lives in
 * `@tzurot/common-types/utils/ownVoice` (`isOwnPersonaVoice`) so api-gateway
 * (job creation) and ai-worker (transcript rendering) consult ONE decision
 * point instead of independently reimplementing `=== 'assistant'`.
 */

import { type RenderableVoice } from '../prompt/QuoteFormatter.js';

/**
 * Rendered in place of a transcript for the persona's own voice message.
 * Deliberately NOT the `'untranscribed'` status: that vocabulary is reserved
 * for a genuine STT failure, and reusing it here would tell the model
 * transcription broke when nothing was ever attempted.
 */
export const OWN_VOICE_DESCRIPTION =
  "The character's own voice message — its spoken text is the message content.";

/**
 * Render-side belt-and-suspenders: replace a voice attachment's transcript
 * (or failure status) with the static own-voice description, regardless of
 * what it currently carries. Used wherever a reference's voice block is
 * rendered from something that could have been computed or persisted BEFORE
 * this guard existed — a stale Redis cache entry, a stored
 * `attachmentEnrichment` row — so an old transcript cannot leak back in.
 * Identity fields (filename, contentType, durationSeconds) survive; only the
 * enrichment changes.
 */
export function redactOwnVoiceTranscript(attachment: RenderableVoice): RenderableVoice {
  return {
    kind: 'voice',
    filename: attachment.filename,
    contentType: attachment.contentType,
    durationSeconds: attachment.durationSeconds,
    description: OWN_VOICE_DESCRIPTION,
  };
}
