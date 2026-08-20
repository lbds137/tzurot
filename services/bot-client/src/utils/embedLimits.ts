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

/**
 * Clamp text to an embed cap, marking the cut with an ellipsis.
 *
 * Measured in UTF-16 code units on purpose — discord.js validates `.length`,
 * so a code-point cap could still admit a string that throws. The one
 * code-unit hazard is cutting INSIDE a surrogate pair, which leaves a broken
 * glyph before the ellipsis; the trailing high surrogate is dropped instead.
 */
export function clampEmbedText(text: string, max: number): string {
  // A non-positive cap has no room for content OR the ellipsis; empty is the
  // only honest output (slice with a negative end would wrap around).
  if (max <= 0) {
    return '';
  }
  if (text.length <= max) {
    return text;
  }
  let cut = text.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    cut = cut.slice(0, -1);
  }
  return `${cut}\u2026`;
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
