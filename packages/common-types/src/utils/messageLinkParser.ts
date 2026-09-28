/**
 * Message Link Parser
 *
 * Parses Discord message links and replaces them with numbered references
 * for better LLM understanding of which reference is which. Optionally also
 * parses links under a configured self-hosted Discord-compatible instance
 * origin — this module stays pure (no config import); callers read
 * `DISCORD_INSTANCE_ORIGIN` at the config boundary and pass it in.
 */

import {
  escapeRegExpLiteral,
  DISCORD_HOST_PATTERN,
  MESSAGE_LINK_PATH_PATTERN,
} from './discordInstanceOrigin.js';

/**
 * Parsed message link structure
 */
export interface ParsedMessageLink {
  /** Guild ID — null for DM links (`/@me/`); matches discord.js Message#guildId semantics */
  guildId: string | null;
  channelId: string;
  messageId: string;
  fullUrl: string;
}

/**
 * Message Link Parser
 * Handles parsing and replacing Discord message links
 */
export class MessageLinkParser {
  /**
   * Regex for Discord message links, composed from `DISCORD_HOST_PATTERN` +
   * `MESSAGE_LINK_PATH_PATTERN` (single-sourced in `discordInstanceOrigin.ts`).
   * Supports: discord.com, ptb.discord.com, canary.discord.com, discordapp.com
   *
   * The guild segment matches `@me` (DM links) or a numeric snowflake (guild links).
   * `parseMessageLinks` maps `@me` to `null` so consumers see `string | null` rather
   * than a magic-string sentinel.
   */
  static readonly MESSAGE_LINK_REGEX = new RegExp(
    `${DISCORD_HOST_PATTERN}${MESSAGE_LINK_PATH_PATTERN}`,
    'g'
  );

  /**
   * Build the message-link regex, additively matching a configured instance
   * origin alongside the Discord hosts. Group indexes stay aligned with
   * `MESSAGE_LINK_REGEX` regardless of branch: group 1 is the ptb/canary
   * prefix (undefined for both discordapp.com and the instance-origin
   * branch), groups 2-4 are guild-or-@me/channel/message. Unset origin
   * returns an equivalent regex to `MESSAGE_LINK_REGEX` (verified by test),
   * keeping unset behavior byte-identical.
   */
  static buildMessageLinkRegex(instanceOrigin?: string): RegExp {
    if (instanceOrigin === undefined) {
      return new RegExp(this.MESSAGE_LINK_REGEX);
    }
    return new RegExp(
      `(?:${DISCORD_HOST_PATTERN}|${escapeRegExpLiteral(instanceOrigin)})${MESSAGE_LINK_PATH_PATTERN}`,
      'g'
    );
  }

  /**
   * Parse all Discord message links from content
   * @param content - Message content to parse
   * @param instanceOrigin - Optional configured self-hosted instance origin;
   *   when set, links under that origin are parsed alongside Discord links.
   * @returns Array of parsed message links
   */
  static parseMessageLinks(content: string, instanceOrigin?: string): ParsedMessageLink[] {
    const links: ParsedMessageLink[] = [];
    const regex = this.buildMessageLinkRegex(instanceOrigin);

    let match;
    while ((match = regex.exec(content)) !== null) {
      const rawGuildSegment = match[2];
      links.push({
        guildId: rawGuildSegment === '@me' ? null : rawGuildSegment,
        channelId: match[3],
        messageId: match[4],
        fullUrl: match[0],
      });
    }

    return links;
  }

  /**
   * Replace message links with numbered references
   * @param content - Original message content
   * @param linkMap - Map of full URL to reference number
   * @returns Content with links replaced by "[Reference N]"
   */
  static replaceLinksWithReferences(content: string, linkMap: Map<string, number>): string {
    let result = content;

    // Sort by URL length (longest first) to avoid partial replacements
    const sortedEntries = Array.from(linkMap.entries()).sort((a, b) => b[0].length - a[0].length);

    for (const [url, number] of sortedEntries) {
      // Use replaceAll to replace all occurrences (handles duplicate links)
      result = result.replaceAll(url, `[Reference ${number}]`);
    }

    return result;
  }
}
