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

/** Clamp text to an embed cap, marking the cut with an ellipsis. */
export function clampEmbedText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}\u2026`;
}

export const EMBED_CAPS = {
  title: DISCORD_LIMITS.EMBED_TITLE,
  description: DISCORD_LIMITS.EMBED_DESCRIPTION,
  fieldName: DISCORD_LIMITS.EMBED_FIELD_NAME,
  fieldValue: DISCORD_LIMITS.EMBED_FIELD,
  footer: DISCORD_LIMITS.EMBED_FOOTER,
} as const;
