/**
 * Hard clamps for Discord embed payload caps.
 *
 * discord.js validates embed parts at build time (shapeshift), so a single
 * over-limit string THROWS and takes the whole reply down — the failure mode
 * is total, not cosmetic. Schema-legal data reaches these caps: a 1000-char
 * personalityTone plus markdown escaping (which can double a name) exceeds
 * the 1024-char field value, and a 255-char display name exceeds the
 * 256-char title once a prefix is added. Clamp at the payload boundary; what
 * a PREVIEW should show is the caller's judgment, this is the safety net.
 */
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { truncateToUtf16Units } from '@tzurot/common-types/utils/codePointTruncation';

/**
 * Clamp text to an embed cap, marking the cut with an ellipsis.
 *
 * Measured in UTF-16 code units on purpose — discord.js validates `.length`,
 * so a code-point cap could still admit a string that throws. The
 * surrogate-safe cut itself is delegated to the shared
 * `truncateToUtf16Units` helper.
 */
export function clampEmbedText(text: string, max: number): string {
  // A non-positive cap yields the empty string through the helper's own floor
  // (the budget cannot fit the ellipsis); pinned in embedLimits.test.ts.
  return truncateToUtf16Units(text, max, '\u2026');
}

export const EMBED_CAPS = {
  title: DISCORD_LIMITS.EMBED_TITLE,
  description: DISCORD_LIMITS.EMBED_DESCRIPTION,
  fieldName: DISCORD_LIMITS.EMBED_FIELD_NAME,
  fieldValue: DISCORD_LIMITS.EMBED_FIELD,
  footer: DISCORD_LIMITS.EMBED_FOOTER,
} as const;

/**
 * Inline embed field with its value clamped at the platform cap — the
 * literal-object form throws at build time when a schema-legal value (a
 * 1000-char tone) exceeds the 1024-char field cap.
 */
export function cappedInlineField(
  name: string,
  value: string
): { name: string; value: string; inline: true } {
  return {
    name: clampEmbedText(name, EMBED_CAPS.fieldName),
    value: clampEmbedText(value, EMBED_CAPS.fieldValue),
    inline: true,
  };
}
