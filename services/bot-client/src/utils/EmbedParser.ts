/**
 * Embed Parser
 *
 * Extracts and formats Discord embeds as XML for LLM prompts.
 * Uses consistent XML format to match the rest of the prompt structure.
 */

import { type APIEmbed, type APIEmbedField, type Message } from 'discord.js';
import { escapeXml } from '@tzurot/common-types/utils/xmlBuilder';
import { EMBED_NAMING } from '@tzurot/common-types/constants/media';
import { embedImageAttachmentName } from './embedAttachmentName.js';

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

    // Add author with optional URL
    const author = formatAuthor(embed);
    if (author !== null) {
      parts.push(author);
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

    return parts.join('\n');
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

    const embedStrings = message.embeds.map((embed, index) => {
      const numAttr = message.embeds.length > 1 ? ` number="${index + 1}"` : '';
      return `<embed${numAttr}>\n${this.parseEmbed(embed.toJSON(), index)}\n</embed>`;
    });

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
