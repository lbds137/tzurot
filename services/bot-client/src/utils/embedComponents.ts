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
import { EMBED_LIMITS } from '@tzurot/common-types/constants/media';
import { type EmbedNameScope, embedMediaAttachmentName } from './embedAttachmentName.js';

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

/**
 * Collect the media entries of one MediaGallery node's `items` array,
 * stopping once `budget` valid entries have been collected — so a gallery
 * with thousands of items past the shared cap is not mapped in full.
 */
function collectGalleryItemMedia(
  node: APIMediaGalleryComponent,
  budget: number
): EmbedComponentMedia[] {
  const items = (node as { items?: unknown }).items;
  if (!Array.isArray(items) || budget <= 0) {
    return [];
  }
  const media: EmbedComponentMedia[] = [];
  for (const item of items) {
    if (media.length >= budget) {
      break;
    }
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
 * Deepest nesting level the walk descends to; top-level nodes are level 1.
 * The deepest shape this module reads is Container, then Section, then the
 * Section's TextDisplay (level 3), so 4 leaves one level of headroom.
 * Nodes below it are dropped without an error.
 */
export const MAX_EMBED_COMPONENT_DEPTH = 4;

/** One readable part of a Components-V2 tree, in document order. */
export type EmbedComponentPart =
  { kind: 'text'; content: string } | { kind: 'media'; media: EmbedComponentMedia };

/** Read a node's `components` array, when it is one. */
function childrenOf(node: unknown): unknown[] | undefined {
  const children = (node as { components?: unknown }).components;
  return Array.isArray(children) ? children : undefined;
}

/** Push a TextDisplay node's non-empty `content` onto `parts`, in place. */
function visitTextDisplay(node: APITextDisplayComponent, parts: EmbedComponentPart[]): void {
  const content = (node as { content?: unknown }).content;
  if (typeof content === 'string' && content.length > 0) {
    parts.push({ kind: 'text', content });
  }
}

/** Hand each of a Section's descended children, then its own accessory, through the walk. */
function visitSection(
  node: APISectionComponent,
  depth: number,
  visitChildren: (nodes: unknown[], depth: number) => void,
  addMedia: (entry: EmbedComponentMedia) => void
): void {
  const children = childrenOf(node);
  if (children !== undefined) {
    visitChildren(children, depth + 1);
  }
  collectSectionAccessoryMedia(node).forEach(addMedia);
}

/** Descend into a Container's children, when it has an array of them. */
function visitContainer(
  node: APIContainerComponent,
  depth: number,
  visitChildren: (nodes: unknown[], depth: number) => void
): void {
  const children = childrenOf(node);
  if (children !== undefined) {
    visitChildren(children, depth + 1);
  }
}

/**
 * Walk a Components-V2 tree once, in document order, yielding text and media
 * as a single interleaved sequence — a Section yields its own text, then its
 * accessory image, before the next sibling. The text render and the image
 * extraction both read this one walk, so they pair a Section's caption with
 * its picture identically and number media identically. Media past
 * `EMBED_LIMITS.MAX_MEDIA_PER_EMBED` and nodes past
 * `MAX_EMBED_COMPONENT_DEPTH` are dropped rather than erroring.
 */
export function walkEmbedComponents(components: unknown[]): EmbedComponentPart[] {
  const parts: EmbedComponentPart[] = [];
  let mediaCount = 0;

  const addMedia = (entry: EmbedComponentMedia): void => {
    if (mediaCount >= EMBED_LIMITS.MAX_MEDIA_PER_EMBED) {
      return;
    }
    parts.push({ kind: 'media', media: entry });
    mediaCount++;
  };

  const visit = (nodes: unknown[], depth: number): void => {
    if (depth > MAX_EMBED_COMPONENT_DEPTH) {
      return;
    }
    for (const node of nodes) {
      if (isTextDisplay(node)) {
        visitTextDisplay(node, parts);
        continue;
      }
      if (isMediaGallery(node)) {
        const remaining = EMBED_LIMITS.MAX_MEDIA_PER_EMBED - mediaCount;
        collectGalleryItemMedia(node, remaining).forEach(addMedia);
        continue;
      }
      if (isSection(node)) {
        visitSection(node, depth, visit, addMedia);
        continue;
      }
      if (isContainer(node)) {
        visitContainer(node, depth, visit);
      }
    }
  };

  visit(components, 1);
  return parts;
}

/**
 * Collect every media item in document order, via the shared walk — capped
 * at `EMBED_LIMITS.MAX_MEDIA_PER_EMBED`.
 */
export function collectEmbedComponentMedia(components: unknown[]): EmbedComponentMedia[] {
  return walkEmbedComponents(components)
    .filter((part): part is Extract<EmbedComponentPart, { kind: 'media' }> => part.kind === 'media')
    .map(part => part.media);
}

/**
 * Read the first top-level Container's NUMERIC accent color, skipping any
 * top-level Container without one. Top-level Containers only — does not
 * recurse into nested ones.
 */
export function readContainerAccentColor(components: unknown[]): number | undefined {
  for (const node of components) {
    if (isContainer(node)) {
      const accentColor = (node as { accent_color?: unknown }).accent_color;
      if (typeof accentColor === 'number') {
        return accentColor;
      }
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
  return walkEmbedComponents(nodes).length > 0;
}

/**
 * Render an embed's Components-V2 tree as prompt XML lines: text and media
 * (naming the ORIGINAL media url — the proxy is reserved for the vision
 * attachment — matching how the legacy `<image>` element carries
 * `embed.image.url`, with an optional `description` alt-text attribute)
 * follow document order in one pass — a Section renders its text, then its
 * accessory image, before its sibling — then the accent color formatted the
 * same way `parseEmbed` formats `embed.color` — only when `embed.color`
 * itself is undefined, so a legacy color and a Components-V2 accent color
 * never both render as `<color>` lines; the legacy value wins. Spoiler media
 * is labeled with a `spoiler="true"` attribute rather than withheld — the
 * label is what tells the character the poster hid it. Markdown inside
 * TextDisplay content is left verbatim; the model reads markdown. Returns an
 * empty array when there is nothing to render. The media numbering here
 * matches `extractEmbedImages` because both read `walkEmbedComponents`.
 *
 * @param scope - Snapshot scope, when this embed came from a forwarded snapshot
 */
export function formatEmbedComponentsXml(
  embed: APIEmbed,
  embedIndex: number,
  scope?: EmbedNameScope
): string[] {
  const nodes = readEmbedComponents(embed);
  const lines: string[] = [];
  let mediaIndex = 0;

  for (const part of walkEmbedComponents(nodes)) {
    if (part.kind === 'text') {
      lines.push(`<text>${escapeXml(part.content)}</text>`);
      continue;
    }
    const filename = embedMediaAttachmentName(embedIndex, mediaIndex, scope);
    mediaIndex++;
    const descriptionAttr =
      part.media.description !== undefined
        ? ` description="${escapeXml(part.media.description)}"`
        : '';
    const spoilerAttr = part.media.spoiler === true ? ' spoiler="true"' : '';
    lines.push(
      `<image filename="${escapeXml(filename)}" url="${escapeXml(part.media.url)}"${descriptionAttr}${spoilerAttr}/>`
    );
  }

  const accentColor = embed.color === undefined ? readContainerAccentColor(nodes) : undefined;
  if (accentColor !== undefined) {
    const hexColor = `#${accentColor.toString(16).padStart(6, '0')}`;
    lines.push(`<color>${hexColor}</color>`);
  }

  return lines;
}
