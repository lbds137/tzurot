/**
 * Reference author-role resolution.
 *
 * The authoritative role for a reference is the `authorRole` stamped at receive
 * time in bot-client (where the Discord `applicationId` + `client.user.id` are
 * available — see classifyReferenceAuthorRole). That stamp is persona-AGNOSTIC:
 * `assistant` means "one of our personas" because at receive time nobody knows
 * which persona will be responding. The render-time split between "my own
 * line" (`assistant`) and "a sibling persona's line" (`character`) happens
 * HERE, relative to the responding personality — presenting a sibling's words
 * as role="assistant" tells the model they're its own, which contradicts its
 * character identity in multi-persona channels.
 *
 * The name-match fallback exists for when the stamp is absent, and is shared
 * by both render paths so the two stay symmetric:
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
 * The role vocabulary RENDERED into `<quote role="...">` attributes. Extends
 * the stored vocabulary with `character` (a sibling persona), which only
 * exists at render time — storage can't know who the responder will be.
 */
export type RenderedQuoteRole = ReferenceAuthorRole | 'character';

/**
 * Whether an author name matches ONE personality name by prefix.
 * Prefix-match because webhook usernames are `${displayName}${botSuffix}`, so the
 * personality's display name is a prefix of the author name, not the whole of it.
 */
function matchesPersonality(authorName: string, personalityName: string): boolean {
  return authorName.toLowerCase().startsWith(personalityName.toLowerCase());
}

/**
 * Whether a set entry is the SAME persona as the responder under a different
 * name vocabulary — stored rows carry `personality.name` ("Yeshua") while the
 * live path matches against `displayName` ("Yeshua ben Yosef"). Either prefix
 * direction counts. The cost: a sibling whose name is an exact prefix of the
 * responder's reads as a self-variant (accepted bounded edge, same class as
 * the documented name-collision edge on the fallback).
 */
function isSelfVariant(name: string, personalityName: string): boolean {
  return matchesPersonality(personalityName, name) || matchesPersonality(name, personalityName);
}

/**
 * Whether the author matches a SELF-VARIANT entry of the responding persona in
 * the personality set. Used by the no-stamp fallback so a persona's own line,
 * attributed under a different vocabulary than `personalityName`, still
 * resolves to `assistant` instead of misreading as a sibling or a user.
 */
function matchesSelfVariant(
  authorName: string,
  personalityName: string,
  allPersonalityNames?: Set<string>
): boolean {
  if (allPersonalityNames === undefined) {
    return false;
  }
  for (const name of allPersonalityNames) {
    if (isSelfVariant(name, personalityName) && matchesPersonality(authorName, name)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the author positively matches a personality OTHER than the responding
 * one. Self-match is checked first and wins: the caller's `personalityName`
 * vocabulary (displayName on the live path, stored name on the history path)
 * can differ from the webhook-author vocabulary, so demotion requires a
 * POSITIVE sibling match — an author that matches nothing keeps `assistant`
 * (the pre-demotion default) rather than misfiring on the persona's own line,
 * which is the self-reply trap the classifier exists to prevent.
 */
function matchesSiblingPersonality(
  authorName: string,
  personalityName: string,
  allPersonalityNames?: Set<string>
): boolean {
  if (matchesPersonality(authorName, personalityName)) {
    return false;
  }
  if (allPersonalityNames === undefined) {
    return false;
  }
  for (const name of allPersonalityNames) {
    // Self-variant entries are the responder under another vocabulary — never
    // sibling evidence (see isSelfVariant).
    if (!isSelfVariant(name, personalityName) && matchesPersonality(authorName, name)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve a reference's rendered quote role, relative to the RESPONDING
 * personality:
 *
 * - stamped `assistant` (one of our personas) → `character` when the author
 *   positively matches a SIBLING personality in `allPersonalityNames`, else
 *   `assistant` (see `matchesSiblingPersonality` for why unmatched stays put)
 * - stamped `user` / `bot` → authoritative, passed through
 * - no stamp (see module doc for the two absent-role cases) → name-match
 *   fallback: responding personality → `assistant`; any sibling personality →
 *   `character`; otherwise `user`
 *
 * The fallback is a pure name-match with no bot-authorship guard, so within the
 * (bounded) fallback window a human whose display name prefixes a personality's
 * would read as `assistant`/`character`. Accepted as a bounded edge — it needs a
 * name collision AND the reference being in the window. A legacy third-party bot
 * (not one of our personalities) reads as `user` until its reference ages out.
 */
export function deriveRefRole(
  authorRole: ReferenceAuthorRole | undefined,
  authorName: string,
  personalityName: string,
  allPersonalityNames?: Set<string>
): RenderedQuoteRole {
  if (authorRole === 'assistant') {
    return matchesSiblingPersonality(authorName, personalityName, allPersonalityNames)
      ? 'character'
      : 'assistant';
  }
  if (authorRole !== undefined) {
    return authorRole;
  }
  if (
    matchesPersonality(authorName, personalityName) ||
    matchesSelfVariant(authorName, personalityName, allPersonalityNames)
  ) {
    return 'assistant';
  }
  if (matchesSiblingPersonality(authorName, personalityName, allPersonalityNames)) {
    return 'character';
  }
  return 'user';
}
