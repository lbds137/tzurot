/**
 * The single decision point for "is this a persona's own spoken turn."
 * Both api-gateway (job creation) and ai-worker (transcript rendering) must
 * consult this ONE predicate instead of independently reimplementing
 * `=== 'assistant'` and drifting apart.
 *
 * The reasoning is the same everywhere it applies: a persona's own spoken
 * delivery of its own message carries no information beyond that message's
 * text. Re-transcribing it via STT is a wasted (and, for the self-hosted
 * voice-engine, non-free) call, and rendering the transcript merely
 * duplicates content the model already has as `content`.
 */

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
