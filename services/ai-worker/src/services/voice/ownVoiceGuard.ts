/**
 * Own-Persona-Voice Guard
 *
 * The single decision point for "is this voice attachment our own persona's
 * TTS output, and if so what should render in its place." Three sites used to
 * make this call independently (the reference-attachment pipeline, extended-
 * context re-resolution, and the chat_log renderer) — this module exists so
 * they consult ONE predicate instead of three copies of `=== 'assistant'`
 * drifting apart.
 *
 * The reasoning is the same everywhere it applies: a persona's own spoken
 * delivery of its own message carries no information beyond that message's
 * text. Re-transcribing it via STT is a wasted (and, for the self-hosted
 * voice-engine, non-free) call, and rendering the transcript merely duplicates
 * content the model already has as `content`.
 */

import { type RenderableVoice } from '../prompt/QuoteFormatter.js';

/**
 * True when `role` names the responding persona's own turn.
 *
 * Accepts both role vocabularies that use the literal string `'assistant'`:
 * `MessageRole` (conversation-history entries, e.g. extended-context targets)
 * and `ReferenceAuthorRole` (referenced-message authorship — schema-optional,
 * classified once in bot-client via applicationId). Typed as `string |
 * undefined` rather than importing either enum so this predicate has no
 * dependency on which vocabulary a caller happens to hold.
 *
 * Undefined/absent — legacy rows with no stamp, or a role this vocabulary
 * doesn't recognize (`'user'`, `'bot'`, `'system'`) — is NOT our own voice:
 * it fails open to whatever the caller does for ordinary audio.
 */
export function isOwnPersonaVoice(role: string | undefined): boolean {
  return role === 'assistant';
}

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
