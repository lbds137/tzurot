/**
 * Shared tag rendering for the two /character view renderers.
 *
 * The embed renderer (`view.ts`) and the Components-V2 renderer (`viewV2.ts`)
 * must show the same tags — `USE_COMPONENTS_V2` is a kill switch, and a flag
 * flip that silently changed which fields render would defeat the point of
 * keeping the embed path intact. One formatter, two presentation wrappers.
 *
 * Tags are NOT redacted gateway-side (see the `tags` note on the personality
 * formatter), so both the normal and the private-definition views call these.
 */

import { escapeMarkdown, type EmbedBuilder } from 'discord.js';

/** Heading used for the tags block/field in both renderers. */
const TAGS_LABEL = '🏷️ Tags';

/**
 * Comma-joined, markdown-escaped tag list, or null when there are none.
 * `undefined` is accepted because write-path constructions of CharacterData
 * (create/import payloads) can omit the field.
 */
export function formatTagsValue(tags: string[] | undefined): string | null {
  if (tags === undefined || tags.length === 0) {
    return null;
  }
  // Defense-in-depth, not load-bearing: TAG_PATTERN already excludes every
  // markdown character, so this escape is a no-op for validly stored tags.
  return escapeMarkdown(tags.join(', '));
}

/** Add the Tags field to an embed when there are tags; no-op otherwise. */
export function addTagsEmbedField(tags: string[] | undefined, embed: EmbedBuilder): void {
  const value = formatTagsValue(tags);
  if (value === null) {
    return;
  }
  embed.addFields({ name: TAGS_LABEL, value, inline: false });
}

/** Components-V2 text block for the tags, or null when there are none. */
export function tagsBlockText(tags: string[] | undefined): string | null {
  const value = formatTagsValue(tags);
  return value === null ? null : `**${TAGS_LABEL}**\n${value}`;
}
