/**
 * Embed Parser
 *
 * Extracts and formats Discord embeds in an LLM-friendly way
 */

import { APIEmbed, Message } from 'discord.js';

/**
 * Format a single embed field
 * @param name - Field name
 * @param value - Field value
 * @param inline - Whether field is inline
 * @returns Formatted field string
 */
function formatEmbedField(name: string, value: string, inline: boolean): string {
  const inlineIndicator = inline ? ' (inline)' : '';
  return `**${name}**${inlineIndicator}: ${value}`;
}

/**
 * Embed Parser
 * Handles extraction and formatting of Discord embeds
 */
export class EmbedParser {
  /**
   * Parse a single embed into LLM-friendly format
   * @param embed - Discord embed object
   * @returns Formatted embed string
   */
  static parseEmbed(embed: APIEmbed): string {
    const parts: string[] = [];

    // Add title
    if (embed.title) {
      const titleText = embed.url
        ? `[${embed.title}](${embed.url})`
        : embed.title;
      parts.push(`## ${titleText}`);
    }

    // Add author
    if (embed.author) {
      const authorText = embed.author.url
        ? `[${embed.author.name}](${embed.author.url})`
        : embed.author.name;
      parts.push(`Author: ${authorText}`);
    }

    // Add description
    if (embed.description) {
      parts.push(embed.description);
    }

    // Add fields
    if (embed.fields && embed.fields.length > 0) {
      const fieldStrings = embed.fields.map(field =>
        formatEmbedField(field.name, field.value, field.inline ?? false)
      );
      parts.push('', ...fieldStrings);
    }

    // Add image
    if (embed.image?.url) {
      parts.push(``, `Image: ${embed.image.url}`);
    }

    // Add thumbnail
    if (embed.thumbnail?.url) {
      parts.push(`Thumbnail: ${embed.thumbnail.url}`);
    }

    // Add footer
    if (embed.footer?.text) {
      parts.push(``, `_${embed.footer.text}_`);
    }

    // Add timestamp
    if (embed.timestamp) {
      parts.push(`Timestamp: ${embed.timestamp}`);
    }

    // Add color (as hex)
    if (embed.color !== undefined) {
      const hexColor = `#${embed.color.toString(16).padStart(6, '0')}`;
      parts.push(`Color: ${hexColor}`);
    }

    return parts.join('\n');
  }

  /**
   * Parse all embeds from a Discord message
   * @param message - Discord message
   * @returns Formatted embeds string, or empty string if no embeds
   */
  static parseMessageEmbeds(message: Message): string {
    if (!message.embeds || message.embeds.length === 0) {
      return '';
    }

    const embedStrings = message.embeds.map((embed, index) => {
      const embedNumber = message.embeds.length > 1 ? ` ${index + 1}` : '';
      return `### Embed${embedNumber}\n\n${this.parseEmbed(embed.toJSON())}`;
    });

    return embedStrings.join('\n\n---\n\n');
  }

  /**
   * Check if a message has any embeds
   * @param message - Discord message
   * @returns True if message has embeds
   */
  static hasEmbeds(message: Message): boolean {
    return Boolean(message.embeds && message.embeds.length > 0);
  }
}
