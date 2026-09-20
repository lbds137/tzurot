/**
 * Embed Parser
 *
 * Extracts and formats Discord embeds as XML for LLM prompts.
 * Uses consistent XML format to match the rest of the prompt structure.
 */

import { EmbedType, type APIEmbed, type APIEmbedField, type Message } from 'discord.js';
import { escapeXml } from '@tzurot/common-types/utils/xmlBuilder';
import { EMBED_NAMING } from '@tzurot/common-types/constants/media';
import { embedImageAttachmentName } from './embedAttachmentName.js';
import { logEmptyEmbedShape, sortedEmbedKeys } from './embedShapeDiagnostics.js';

/**
 * Check if a string value is present and non-empty
 */
function hasValue(val: string | null | undefined): val is string {
  return val !== undefined && val !== null && val.length > 0;
}

/**
 * Format a URL attribute if the URL is present
 */
function formatUrlAttr(url: string | null | undefined): string {
  if (hasValue(url)) {
    return ` url="${escapeXml(url)}"`;
  }
  return '';
}

/**
 * Format the title element with optional URL
 */
function formatTitle(embed: APIEmbed): string | null {
  if (!hasValue(embed.title)) {
    return null;
  }
  const urlAttr = formatUrlAttr(embed.url);
  return `<title${urlAttr}>${escapeXml(embed.title)}</title>`;
}

/**
 * Format a standalone url element for a title-less embed.
 * When a title is present, embed.url stays on the title's url attribute
 * instead (see formatTitle) — this only fires when there's no title to carry it.
 */
function formatStandaloneUrl(embed: APIEmbed): string | null {
  if (hasValue(embed.title) || !hasValue(embed.url)) {
    return null;
  }
  return `<url>${escapeXml(embed.url)}</url>`;
}

/**
 * Format the author element with optional URL
 */
function formatAuthor(embed: APIEmbed): string | null {
  if (embed.author === undefined || embed.author === null || !hasValue(embed.author.name)) {
    return null;
  }
  const urlAttr = formatUrlAttr(embed.author.url);
  return `<author${urlAttr}>${escapeXml(embed.author.name)}</author>`;
}

/**
 * Format the provider element (name and/or url)
 */
function formatProvider(embed: APIEmbed): string | null {
  const provider = embed.provider;
  if (provider === undefined || provider === null) {
    return null;
  }
  const urlAttr = formatUrlAttr(provider.url);
  if (hasValue(provider.name)) {
    return `<provider${urlAttr}>${escapeXml(provider.name)}</provider>`;
  }
  if (hasValue(provider.url)) {
    return `<provider${urlAttr}/>`;
  }
  return null;
}

/**
 * Format the video element (url with optional width/height)
 */
function formatVideo(embed: APIEmbed): string | null {
  const video = embed.video;
  if (video === undefined || video === null || !hasValue(video.url)) {
    return null;
  }
  const widthAttr = video.width !== undefined ? ` width="${escapeXml(String(video.width))}"` : '';
  const heightAttr =
    video.height !== undefined ? ` height="${escapeXml(String(video.height))}"` : '';
  return `<video url="${escapeXml(video.url)}"${widthAttr}${heightAttr}/>`;
}

/**
 * Format the sorted-keys attribute used on the no-content marker element.
 * Carries key NAMES only, never values — safe for the diagnostic log too.
 *
 * The attribute reports the embed's raw own-property shape — it is NOT a
 * manifest of the elements in the marker's body, and a key can appear here
 * with no matching element beside it. A `{ type: 'rich', color }` embed is
 * the clearest case: it yields `keys="color,type"` over a body holding only
 * `<color>`, because parseEmbed suppresses `<type>` for the `rich` value.
 * Nothing is lost to that difference — the diagnostic log carries `embedType`
 * as its own field — but a raw prompt dump will show a key whose element is
 * absent, which is worth expecting before it reads as a bug during triage.
 */
function formatEmbedKeysAttr(embed: APIEmbed): string {
  const keys = sortedEmbedKeys(embed);
  return keys.length > 0 ? ` keys="${escapeXml(keys.join(','))}"` : '';
}

/**
 * Whether an embed carries anything a character could actually read or
 * describe — title, author name, description, fields, image, thumbnail,
 * footer text, or video — as opposed to fields that only describe the
 * embed's OWN wrapper (`url`, `type`, `provider`, `color`, `timestamp`).
 *
 * `provider` sits on the metadata side deliberately: a provider name alone
 * ("vxReddit") tells the character where a link came from, not what it
 * shows — the same gap this predicate exists to close for the embed as a
 * whole. `video.url` is content, not metadata: it's the media itself.
 */
export function embedHasRenderableContent(embed: APIEmbed): boolean {
  return (
    hasValue(embed.title) ||
    hasValue(embed.author?.name) ||
    hasValue(embed.description) ||
    (embed.fields !== undefined && embed.fields.length > 0) ||
    hasValue(embed.image?.url) ||
    hasValue(embed.thumbnail?.url) ||
    hasValue(embed.footer?.text) ||
    hasValue(embed.video?.url)
  );
}

/**
 * Format the fields section
 */
function formatFields(fields: APIEmbedField[] | undefined): string[] {
  if (fields === undefined || fields.length === 0) {
    return [];
  }

  const parts: string[] = ['<fields>'];
  for (const field of fields) {
    const inlineAttr = field.inline === true ? ' inline="true"' : '';
    parts.push(
      `<field name="${escapeXml(field.name)}"${inlineAttr}>${escapeXml(field.value)}</field>`
    );
  }
  parts.push('</fields>');
  return parts;
}

/**
 * Embed Parser
 * Handles extraction and formatting of Discord embeds as XML
 */
export class EmbedParser {
  /**
   * Parse a single embed into XML format
   * @param embed - Discord embed object
   * @param embedIndex - Zero-based index of this embed within its message's embed
   * array; used to derive the same synthetic attachment filename the extractor
   * mints for this embed's image/thumbnail, so a vision description in the
   * attachments block can be bound back to this embed
   * @returns Formatted embed XML string
   */
  static parseEmbed(embed: APIEmbed, embedIndex: number): string {
    const parts: string[] = [];

    // Add title with optional URL
    const title = formatTitle(embed);
    if (title !== null) {
      parts.push(title);
    }

    // Add standalone url — only when there's no title to carry it as an attribute
    const standaloneUrl = formatStandaloneUrl(embed);
    if (standaloneUrl !== null) {
      parts.push(standaloneUrl);
    }

    // Add author with optional URL
    const author = formatAuthor(embed);
    if (author !== null) {
      parts.push(author);
    }

    // Add provider
    const provider = formatProvider(embed);
    if (provider !== null) {
      parts.push(provider);
    }

    // Add description
    if (hasValue(embed.description)) {
      parts.push(`<description>${escapeXml(embed.description)}</description>`);
    }

    // Add fields
    parts.push(...formatFields(embed.fields));

    // Add image — the filename is the join key to the <attachments> entry the
    // vision pipeline produces for this same embed slot; both sides derive it
    // from the embed index independently (see embedAttachmentName.ts).
    if (hasValue(embed.image?.url)) {
      const imageFilename = embedImageAttachmentName(embedIndex, EMBED_NAMING.IMAGE_SLOT);
      parts.push(
        `<image filename="${escapeXml(imageFilename)}" url="${escapeXml(embed.image.url)}"/>`
      );
    }

    // Add thumbnail
    if (hasValue(embed.thumbnail?.url)) {
      const thumbnailFilename = embedImageAttachmentName(embedIndex, EMBED_NAMING.THUMBNAIL_SLOT);
      parts.push(
        `<thumbnail filename="${escapeXml(thumbnailFilename)}" url="${escapeXml(embed.thumbnail.url)}"/>`
      );
    }

    // Add video
    const video = formatVideo(embed);
    if (video !== null) {
      parts.push(video);
    }

    // Add footer
    if (hasValue(embed.footer?.text)) {
      parts.push(`<footer>${escapeXml(embed.footer.text)}</footer>`);
    }

    // Add timestamp
    if (hasValue(embed.timestamp)) {
      parts.push(`<timestamp>${escapeXml(embed.timestamp)}</timestamp>`);
    }

    // Add color (as hex)
    if (embed.color !== undefined) {
      const hexColor = `#${embed.color.toString(16).padStart(6, '0')}`;
      parts.push(`<color>${hexColor}</color>`);
    }

    // Add type — suppressed for the `rich` value only, on signal value rather
    // than frequency. Discord documents `rich` as the generic type for an
    // embed rendered from its own attributes, so it names the rendering mode
    // and adds nothing the rendered fields beside it do not already carry. A
    // `link`, `video`, `gifv`, `article` or `image` type instead names what
    // kind of thing an auto-generated unfurl wrapped, which is the signal the
    // no-content investigation needs.
    const embedType = embed.type;
    if (hasValue(embedType) && embedType !== EmbedType.Rich) {
      parts.push(`<type>${escapeXml(embedType)}</type>`);
    }

    return parts.join('\n');
  }

  /**
   * Wrap a single embed's parsed body in its `<embed>` element, including the
   * `number="N"` attribute when this embed is one of several.
   *
   * When the embed carries no renderable CONTENT — per
   * {@link embedHasRenderableContent} — this renders a `rendered="false"`
   * marker instead of the ordinary wrapped form, whether or not `parseEmbed`
   * produced any metadata body. A link-unfurl carrying only `url`/`type`
   * (the vxreddit shape) still renders a non-empty `parseEmbed` body, but
   * that body is wrapper metadata, not something the character can describe
   * — so it trips the marker the same as a genuinely empty embed. Omitting
   * the element outright would make the embed's existence invisible
   * downstream, re-creating in a different form exactly the divergence this
   * guard exists to close: "an embed was present" and "an embed rendered
   * content" would again be indistinguishable predicates with nothing
   * checking the difference between them. The marker keeps that divergence
   * visible, names the keys the embed carried (names only, never values —
   * see {@link formatEmbedKeysAttr}), and keeps the `number="N"` sequence
   * coherent when one embed among several has no content.
   *
   * The marker takes one of two forms depending on whether `parseEmbed`
   * produced a metadata body: self-closing when it produced nothing at all,
   * or open/close with that metadata preserved inside when it did — dropping
   * a `url` the character could still have used or shown would be a smaller
   * version of the same silent loss this marker exists to prevent.
   *
   * @param embed - Discord embed object
   * @param embedIndex - Zero-based index of this embed within its source array
   * @param embedCount - Total number of embeds in the source array
   * @param message - The live Discord message, when available, for the
   *   diagnostic component-shape log on a no-content render (absent for
   *   stored/snapshot embeds, which have no live message to inspect)
   * @returns The wrapped `<embed>...</embed>` element for a content-bearing
   *   embed, or one of the two `rendered="false"` marker forms otherwise
   */
  static formatEmbedElement(
    embed: APIEmbed,
    embedIndex: number,
    embedCount: number,
    message?: Message
  ): string {
    const numAttr = embedCount > 1 ? ` number="${embedIndex + 1}"` : '';
    const body = this.parseEmbed(embed, embedIndex);

    if (!embedHasRenderableContent(embed)) {
      logEmptyEmbedShape(embed, message);
      const keysAttr = formatEmbedKeysAttr(embed);
      if (body.length === 0) {
        return `<embed${numAttr} rendered="false"${keysAttr}/>`;
      }
      return `<embed${numAttr} rendered="false"${keysAttr}>\n${body}\n</embed>`;
    }

    return `<embed${numAttr}>\n${body}\n</embed>`;
  }

  /**
   * Parse all embeds from a Discord message
   * @param message - Discord message
   * @returns Formatted embeds XML string, or empty string if no embeds
   */
  static parseMessageEmbeds(message: Message): string {
    if (message.embeds === undefined || message.embeds === null || message.embeds.length === 0) {
      return '';
    }

    const embedStrings = message.embeds.map((embed, index) =>
      this.formatEmbedElement(embed.toJSON(), index, message.embeds.length, message)
    );

    return embedStrings.join('\n');
  }

  /**
   * Check if a message has any embeds
   * @param message - Discord message
   * @returns True if message has embeds
   */
  static hasEmbeds(message: Message): boolean {
    return message.embeds !== undefined && message.embeds !== null && message.embeds.length > 0;
  }
}
