/**
 * Masks header id-disambiguation tags out of /inspect diagnostic payloads
 * for viewers who are not the bot owner.
 *
 * `buildHeaderLine` in ai-worker's `RealMessagesBuilder.ts` renders
 * `${safeName} (id:${idTag})`, and the width table this mask bounds comes
 * from `@tzurot/common-types/constants/headerIdTags`.
 *
 * ai-worker's `ID_TAG_PATTERN` bounds the same widths for its output-side
 * strip; both it and this mask build their pattern from that shared
 * constant, which is what keeps the two sides of the service boundary from
 * drifting apart.
 *
 * Case-insensitive for the same reason the ai-worker sibling is: this also
 * meets a model's echo of the format, which is not bound to the platform's
 * lowercase rendering.
 *
 * The parentheses and `id:` survive the mask so a reader can see a tag was
 * present without seeing which id it named.
 */

import { buildHeaderIdTagPattern } from '@tzurot/common-types/constants/headerIdTags';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import type { DiagnosticPayload } from '@tzurot/common-types/types/diagnostic';
import type { ViewContext } from './viewContext.js';

// Module-scope cache is safe only because the sole consumer is `String.replace`,
// which resets `lastIndex` before scanning; a `.test()`/`.exec()` loop on this
// shared `g` instance would reintroduce the hazard the builder's doc names.
const HEADER_ID_TAG_PATTERN = buildHeaderIdTagPattern();

/** Replace every header id tag in `text` with a masked placeholder. */
export function maskHeaderIdTags(text: string): string {
  return text.replace(HEADER_ID_TAG_PATTERN, '(id:····)');
}

function maskDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    return maskHeaderIdTags(value);
  }
  if (Array.isArray(value)) {
    return value.map(maskDeep);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)]));
  }
  return value;
}

/** Walk the whole diagnostic payload, masking header id tags in every string field. */
export function maskPayloadHeaderIdTags(payload: DiagnosticPayload): DiagnosticPayload {
  return maskDeep(payload) as DiagnosticPayload;
}

/**
 * The single decision seam: a bot-owner viewer gets the payload byte-exact,
 * everyone else gets it with header id tags masked — including a personality
 * owner who is not the bot owner, since `canViewCharacter` gates something
 * different (character-internal redaction, not id-tag masking).
 *
 * Reference-identity asymmetry (unverified by a test — a caller-discipline
 * invariant, not a pinned behaviour): the owner branch returns the SAME
 * payload reference, while the non-owner branch (here and in `payloadForUser`)
 * returns a fresh deep clone via `maskPayloadHeaderIdTags`. Callers must treat
 * the returned payload as read-only and must not rely on either identity.
 */
export function payloadForViewer(payload: DiagnosticPayload, ctx: ViewContext): DiagnosticPayload {
  return ctx.isBotOwner ? payload : maskPayloadHeaderIdTags(payload);
}

/**
 * Same decision as `payloadForViewer`, for callers that hold a raw Discord
 * user id rather than a computed `ViewContext` — `computeViewContext`
 * (`viewContext.ts`) is where the two agree, since it derives `ctx.isBotOwner`
 * from this same `isBotOwner` predicate.
 */
export function payloadForUser(payload: DiagnosticPayload, userId: string): DiagnosticPayload {
  return isBotOwner(userId) ? payload : maskPayloadHeaderIdTags(payload);
}
