/**
 * Embed Components (Components-V2) Reader
 *
 * This module owns all reading of the Components-V2 tree Discord attaches to
 * some link-unfurl embeds under an embed's `components` key. That key is
 * undocumented by Discord and untyped in discord-api-types at the installed
 * version, so every read here is guard-first over `unknown` rather than
 * trusting a declared type.
 */

import {
  ComponentType,
  type APIContainerComponent,
  type APITextDisplayComponent,
  type APIMediaGalleryComponent,
  type APISectionComponent,
  type APIThumbnailComponent,
  type APIEmbed,
} from 'discord.js';
import { escapeXml } from '@tzurot/common-types/utils/xmlBuilder';
import { embedMediaAttachmentName } from './embedAttachmentName.js';

/**
 * Read the Components-V2 tree attached to an embed, if any.
 */
export function readEmbedComponents(embed: APIEmbed): unknown[] {
  const components = (embed as { components?: unknown }).components;
  return Array.isArray(components) ? components : [];
}

function hasType(value: unknown, type: ComponentType): boolean {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === type;
}

/** Narrow an unknown component node to a Container. */
function isContainer(value: unknown): value is APIContainerComponent {
  return hasType(value, ComponentType.Container);
}

/** Narrow an unknown component node to a TextDisplay. */
function isTextDisplay(value: unknown): value is APITextDisplayComponent {
  return hasType(value, ComponentType.TextDisplay);
}

/** Narrow an unknown component node to a MediaGallery. */
function isMediaGallery(value: unknown): value is APIMediaGalleryComponent {
  return hasType(value, ComponentType.MediaGallery);
}

/** Narrow an unknown component node to a Section. */
function isSection(value: unknown): value is APISectionComponent {
  return hasType(value, ComponentType.Section);
}

/** Narrow an unknown component node to a Thumbnail. */
function isThumbnail(value: unknown): value is APIThumbnailComponent {
  return hasType(value, ComponentType.Thumbnail);
}

/**
 * Collect every TextDisplay `content` string in document order, descending
 * into Container and Section children. Skips a `content` that is not a
 * string or is empty.
 */
export function collectEmbedComponentText(components: unknown[]): string[] {
  const texts: string[] = [];
  for (const node of components) {
    if (isTextDisplay(node)) {
      const content = (node as { content?: unknown }).content;
      if (typeof content === 'string' && content.length > 0) {
        texts.push(content);
      }
      continue;
    }
    if (isContainer(node) || isSection(node)) {
      const children = (node as { components?: unknown }).components;
      if (Array.isArray(children)) {
        texts.push(...collectEmbedComponentText(children));
      }
    }
  }
  return texts;
}

/** One media item collected from a MediaGallery or a Section's Thumbnail accessory. */
export interface EmbedComponentMedia {
  url: string;
  proxyUrl?: string;
  /**
   * MIME type, always an `image/*` value when present — a non-image
   * `content_type` makes `readMediaEntry` skip the item entirely rather than
   * reach this field. Absent when Discord did not send a `content_type` at
   * all (legacy parity: not every payload includes one). MIME types are
   * case-insensitive (RFC 2045), so the value is lowercased before the check
   * and stored lowered.
   */
  contentType?: string;
  description?: string;
  /**
   * True when the poster marked this item as a spoiler. The XML renderer —
   * see {@link formatEmbedComponentsXml} — labels it, never withholds it.
   * Absent (rather than `false`) when the source did not mark it a spoiler.
   */
  spoiler?: boolean;
}

/**
 * Read one media entry from a MediaGalleryItem or a Thumbnail accessory —
 * both carry `media`, `description`, and `spoiler` at the same level.
 * Returns undefined when `media.url` is missing, non-string, or empty, or
 * when `media.content_type` is present and is not an `image/*` value. An
 * absent `content_type` keeps the item — Discord does not always send one.
 */
function readMediaEntry(source: unknown): EmbedComponentMedia | undefined {
  if (typeof source !== 'object' || source === null) {
    return undefined;
  }
  const media = (source as { media?: unknown }).media;
  if (typeof media !== 'object' || media === null) {
    return undefined;
  }
  const url = (media as { url?: unknown }).url;
  if (typeof url !== 'string' || url.length === 0) {
    return undefined;
  }
  const contentTypeRaw = (media as { content_type?: unknown }).content_type;
  const contentType = typeof contentTypeRaw === 'string' ? contentTypeRaw.toLowerCase() : undefined;
  if (contentType !== undefined && !contentType.startsWith('image/')) {
    return undefined;
  }
  const proxyUrlRaw = (media as { proxy_url?: unknown }).proxy_url;
  const proxyUrl =
    typeof proxyUrlRaw === 'string' && proxyUrlRaw.length > 0 ? proxyUrlRaw : undefined;
  const descriptionRaw = (source as { description?: unknown }).description;
  const description =
    typeof descriptionRaw === 'string' && descriptionRaw.length > 0 ? descriptionRaw : undefined;
  const spoilerRaw = (source as { spoiler?: unknown }).spoiler;
  const spoiler = spoilerRaw === true ? true : undefined;
  return { url, proxyUrl, contentType, description, spoiler };
}

/** Collect the media entries of one MediaGallery node's `items` array. */
function collectGalleryItemMedia(node: APIMediaGalleryComponent): EmbedComponentMedia[] {
  const items = (node as { items?: unknown }).items;
  if (!Array.isArray(items)) {
    return [];
  }
  const media: EmbedComponentMedia[] = [];
  for (const item of items) {
    const entry = readMediaEntry(item);
    if (entry !== undefined) {
      media.push(entry);
    }
  }
  return media;
}

/** Collect the media entry of one Section node's `accessory`, when it is a Thumbnail. */
function collectSectionAccessoryMedia(node: APISectionComponent): EmbedComponentMedia[] {
  const accessory = (node as { accessory?: unknown }).accessory;
  if (!isThumbnail(accessory)) {
    return [];
  }
  const entry = readMediaEntry(accessory);
  return entry === undefined ? [] : [entry];
}

/**
 * Collect every media item in document order, descending into Containers.
 * Two sources per node: a MediaGallery's `items`, and a Section's `accessory`
 * when it is a Thumbnail.
 */
export function collectEmbedComponentMedia(components: unknown[]): EmbedComponentMedia[] {
  const media: EmbedComponentMedia[] = [];
  for (const node of components) {
    if (isMediaGallery(node)) {
      media.push(...collectGalleryItemMedia(node));
      continue;
    }
    if (isSection(node)) {
      media.push(...collectSectionAccessoryMedia(node));
      continue;
    }
    if (isContainer(node)) {
      const children = (node as { components?: unknown }).components;
      if (Array.isArray(children)) {
        media.push(...collectEmbedComponentMedia(children));
      }
    }
  }
  return media;
}

/**
 * Read the accent color of the first top-level Container, when it is a
 * number. Top-level Containers only — does not recurse into nested ones.
 */
export function readContainerAccentColor(components: unknown[]): number | undefined {
  for (const node of components) {
    if (isContainer(node)) {
      const accentColor = (node as { accent_color?: unknown }).accent_color;
      return typeof accentColor === 'number' ? accentColor : undefined;
    }
  }
  return undefined;
}

/**
 * Whether an embed's Components-V2 tree carries anything a character could
 * read — collected text or collected media. An empty `components` array, and
 * a Container holding only node types this module skips (Separator, File,
 * ActionRow, buttons), are both not content.
 */
export function embedComponentsHaveContent(embed: APIEmbed): boolean {
  const nodes = readEmbedComponents(embed);
  return (
    collectEmbedComponentText(nodes).length > 0 || collectEmbedComponentMedia(nodes).length > 0
  );
}

/**
 * Render an embed's Components-V2 tree as prompt XML lines: text first, then
 * media (naming the ORIGINAL media url — the proxy is reserved for the
 * vision attachment — matching how the legacy `<image>` element carries
 * `embed.image.url`, with an optional `description` alt-text attribute),
 * then the accent color formatted the same way `parseEmbed` formats
 * `embed.color` — only when `embed.color` itself is undefined, so a legacy
 * color and a Components-V2 accent color never both render as `<color>`
 * lines; the legacy value wins. Spoiler media is labeled with a
 * `spoiler="true"` attribute rather than withheld — the label is what tells
 * the character the poster hid it. Markdown inside TextDisplay content is
 * left verbatim; the model reads markdown. Returns an empty array when there
 * is nothing to render. Text is collected across the WHOLE tree before any
 * media, so a tree with several Sections each carrying its own accessory
 * renders all text lines before all image lines rather than pairing each
 * Section's text with its image; the observed unfurl shape is one Container
 * with one gallery, and per-Section pairing is not implemented.
 */
export function formatEmbedComponentsXml(embed: APIEmbed, embedIndex: number): string[] {
  const nodes = readEmbedComponents(embed);
  const lines: string[] = [];

  for (const text of collectEmbedComponentText(nodes)) {
    lines.push(`<text>${escapeXml(text)}</text>`);
  }

  const media = collectEmbedComponentMedia(nodes);
  media.forEach((item, mediaIndex) => {
    const filename = embedMediaAttachmentName(embedIndex, mediaIndex);
    const descriptionAttr =
      item.description !== undefined ? ` description="${escapeXml(item.description)}"` : '';
    const spoilerAttr = item.spoiler === true ? ' spoiler="true"' : '';
    lines.push(
      `<image filename="${escapeXml(filename)}" url="${escapeXml(item.url)}"${descriptionAttr}${spoilerAttr}/>`
    );
  });

  const accentColor = embed.color === undefined ? readContainerAccentColor(nodes) : undefined;
  if (accentColor !== undefined) {
    const hexColor = `#${accentColor.toString(16).padStart(6, '0')}`;
    lines.push(`<color>${hexColor}</color>`);
  }

  return lines;
}
