/**
 * Message Link Parser
 *
 * Parses Discord message links and replaces them with numbered references
 * for better LLM understanding of which reference is which.
 */

/**
 * Parsed message link structure
 */
export interface ParsedMessageLink {
  guildId: string;
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
   * Regex for Discord message links
   * Supports: discord.com, ptb.discord.com, canary.discord.com, discordapp.com
   */
  static readonly MESSAGE_LINK_REGEX =
    /https:\/\/(ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/g;

  /**
   * Parse all Discord message links from content
   * @param content - Message content to parse
   * @returns Array of parsed message links
   */
  static parseMessageLinks(content: string): ParsedMessageLink[] {
    const links: ParsedMessageLink[] = [];
    const regex = new RegExp(this.MESSAGE_LINK_REGEX);

    let match;
    while ((match = regex.exec(content)) !== null) {
      links.push({
        guildId: match[2],
        channelId: match[3],
        messageId: match[4],
        fullUrl: match[0]
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
  static replaceLinksWithReferences(
    content: string,
    linkMap: Map<string, number>
  ): string {
    let result = content;

    // Sort by URL length (longest first) to avoid partial replacements
    const sortedEntries = Array.from(linkMap.entries()).sort(
      (a, b) => b[0].length - a[0].length
    );

    for (const [url, number] of sortedEntries) {
      // Use replaceAll to replace all occurrences (handles duplicate links)
      result = result.replaceAll(url, `[Reference ${number}]`);
    }

    return result;
  }
}
