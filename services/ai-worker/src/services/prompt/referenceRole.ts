/**
 * Reference author-role resolution.
 *
 * The authoritative role for a reference is the `authorRole` stamped at receive
 * time in bot-client (where the Discord `applicationId` + `client.user.id` are
 * available — see classifyReferenceAuthorRole). These helpers are the FALLBACK
 * for when that stamp is absent, and are shared by both render paths so the two
 * stay symmetric:
 *
 * - the stored-history path (`xmlMetadataFormatters`) — for references persisted
 *   before the classifier shipped, which age out of the conversation-history
 *   window over ~30 days; and
 * - the live path (`ReferencedMessageFormatter`) — for a reference produced by an
 *   old bot-client during a rolling deploy, before it stamps `authorRole`. Both
 *   services deploy from the same merge but as independent Railway services, so
 *   a brief window exists where ai-worker is new and bot-client is not.
 *
 * Without the fallback on the live path, a personality's own reply-target would
 * read as `role="user"` during that window — the exact self-reply confusion the
 * classifier exists to prevent.
 */

import type { ReferenceAuthorRole } from '@tzurot/common-types/types/schemas/message';

/**
 * Whether an author name matches an AI personality (assistant) by prefix.
 * Prefix-match because webhook usernames are `${displayName}${botSuffix}`, so the
 * personality's display name is a prefix of the author name, not the whole of it.
 */
export function isAuthorAssistant(
  authorName: string,
  personalityName: string,
  allPersonalityNames?: Set<string>
): boolean {
  const authorLower = authorName.toLowerCase();
  if (authorLower.startsWith(personalityName.toLowerCase())) {
    return true;
  }
  if (allPersonalityNames === undefined) {
    return false;
  }
  for (const name of allPersonalityNames) {
    if (authorLower.startsWith(name.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve a reference's quote role: prefer the classified `authorRole`; fall back
 * to name-matching when it's absent (see module doc for the two absent-role cases).
 *
 * The fallback only distinguishes assistant vs user — it has no `bot` signal — so a
 * legacy third-party bot (not one of our personalities) reads as `user` until its
 * reference ages out (stored path) or both services finish deploying (live path).
 * When `allPersonalityNames` is omitted, only the active personality's own messages
 * resolve to `assistant`; a sibling personality's reference falls back to `user` in
 * that window.
 *
 * The fallback is a pure name-match with no bot-authorship guard, so within the
 * (bounded) fallback window a human whose display name prefixes a personality's would
 * read as `assistant`. Accepted as a bounded edge — it needs a name collision AND the
 * reference being in the window. The authoritative `authorRole` path has no such
 * ambiguity, and the prior live-path guard (`isBotAuthoredReference`) is intentionally
 * dropped here for symmetry with the stored path, which never had it.
 */
export function deriveRefRole(
  authorRole: ReferenceAuthorRole | undefined,
  authorName: string,
  personalityName: string,
  allPersonalityNames?: Set<string>
): ReferenceAuthorRole {
  return (
    authorRole ??
    (isAuthorAssistant(authorName, personalityName, allPersonalityNames) ? 'assistant' : 'user')
  );
}
