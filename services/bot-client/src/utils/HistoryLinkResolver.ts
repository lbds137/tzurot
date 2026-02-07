/**
 * History Link Resolver
 *
 * Resolves Discord message links within extended context (historical messages).
 * Unlike the main MessageReferenceExtractor which uses [Reference N] format,
 * this injects resolved content inline as blockquotes for better context flow.
 *
 * Budget Management:
 * - Every resolved message counts against the total message budget
 * - If we resolve 10 links from 100 messages, we trim to 90 oldest messages
 * - This ensures total context stays bounded
 *
 * Key Differences from MessageReferenceExtractor:
 * - No embed processing delay (historical messages already have embeds)
 * - Depth limit of 1 (no recursive link resolution)
 * - Inline blockquote format instead of [Reference N]
 * - Budget-aware (resolved messages count against limit)
 */

import type { Message, Client } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import type { StoredReferencedMessage } from '@tzurot/common-types';
import { MessageLinkParser, type ParsedMessageLink } from './MessageLinkParser.js';
import { buildMessageContent } from './MessageContentBuilder.js';

const logger = createLogger('HistoryLinkResolver');

/**
 * Result of resolving links in history
 */
export interface LinkResolutionResult {
  /** Messages with links resolved (possibly trimmed to budget) */
  messages: Message[];
  /** Number of links successfully resolved */
  resolvedCount: number;
  /** Number of links that failed to resolve */
  failedCount: number;
  /** Number of links skipped (already in context) */
  skippedCount: number;
  /** Number of messages trimmed to stay within budget */
  trimmedCount: number;
  /** Resolved references grouped by source message ID, for structured XML formatting */
  resolvedReferences: Map<string, StoredReferencedMessage[]>;
}

/**
 * Options for link resolution
 */
export interface LinkResolutionOptions {
  /** Discord client for fetching messages */
  client: Client;
  /** Maximum total messages (including resolved links) */
  budget: number;
  /** Maximum concurrent fetch operations (default: 5) */
  concurrencyLimit?: number;
  /** Timeout per fetch in ms (default: 3000) */
  fetchTimeout?: number;
}

/**
 * Resolved link info for injection
 */
interface ResolvedLink {
  /** The original link URL */
  url: string;
  /** Message ID containing the link */
  sourceMessageId: string;
  /** Resolved content to inject */
  content: string;
  /** Author display name of the resolved message */
  author: string;
  /** Discord message ID of the resolved message */
  messageId: string;
  /** Username of the resolved message author */
  authorUsername: string;
  /** ISO 8601 timestamp of the resolved message */
  timestamp: string;
}

/**
 * Resolve Discord message links in historical messages
 *
 * @param messages - Messages to process (newest first)
 * @param options - Resolution options
 * @returns Messages with links resolved inline
 */
export async function resolveHistoryLinks(
  messages: Message[],
  options: LinkResolutionOptions
): Promise<LinkResolutionResult> {
  const { client, budget, concurrencyLimit = 5, fetchTimeout = 3000 } = options;

  // Build set of message IDs already in context (for deduplication)
  const contextMessageIds = new Set(messages.map(m => m.id));

  // Scan all messages for links
  const linksToResolve: { link: ParsedMessageLink; sourceMessage: Message }[] = [];

  for (const msg of messages) {
    const links = MessageLinkParser.parseMessageLinks(msg.content);
    for (const link of links) {
      // Skip if target message is already in our context
      if (contextMessageIds.has(link.messageId)) {
        logger.debug(
          { messageId: link.messageId, sourceId: msg.id },
          '[HistoryLinkResolver] Skipping link - target already in context'
        );
        continue;
      }
      linksToResolve.push({ link, sourceMessage: msg });
    }
  }

  if (linksToResolve.length === 0) {
    logger.debug('[HistoryLinkResolver] No links to resolve');
    return {
      messages,
      resolvedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      trimmedCount: 0,
      resolvedReferences: new Map(),
    };
  }

  logger.info(
    { linkCount: linksToResolve.length, messageCount: messages.length },
    '[HistoryLinkResolver] Found links to resolve'
  );

  // Deduplicate links (same target message from different sources)
  const uniqueLinks = deduplicateLinks(linksToResolve);
  const skippedCount = linksToResolve.length - uniqueLinks.length;

  // Calculate how many links we can resolve
  // Strategy: Resolve links, then trim oldest messages to stay within budget
  // Cap at budget to prevent excessive fetching (worst case: all messages have links)
  const maxLinksToResolve = Math.min(uniqueLinks.length, budget);
  const linksToFetch = uniqueLinks.slice(0, maxLinksToResolve);

  if (linksToFetch.length < uniqueLinks.length) {
    logger.info(
      {
        total: uniqueLinks.length,
        fetching: linksToFetch.length,
        budget,
        currentCount: messages.length,
      },
      '[HistoryLinkResolver] Limiting links due to budget'
    );
  }

  // Resolve links with concurrency limit
  const resolvedLinks = await resolveLinksWithConcurrency(
    linksToFetch,
    client,
    concurrencyLimit,
    fetchTimeout
  );

  const resolvedCount = resolvedLinks.length;
  const failedCount = linksToFetch.length - resolvedCount;

  // Process resolved content: strip URLs and build structured references
  const { messages: processedMessages, resolvedReferences } = injectResolvedLinks(
    messages,
    resolvedLinks
  );

  // Trim oldest messages to stay within budget
  // Budget = original messages + resolved links
  // If we resolved N links, we need to trim N messages from the end (oldest)
  const trimmedCount = Math.max(0, processedMessages.length + resolvedCount - budget);
  const finalMessages =
    trimmedCount > 0
      ? processedMessages.slice(0, processedMessages.length - trimmedCount)
      : processedMessages;

  logger.info(
    {
      resolvedCount,
      failedCount,
      skippedCount,
      trimmedCount,
      finalCount: finalMessages.length,
    },
    '[HistoryLinkResolver] Link resolution complete'
  );

  return {
    messages: finalMessages,
    resolvedCount,
    failedCount,
    skippedCount: skippedCount + (uniqueLinks.length - linksToFetch.length),
    trimmedCount,
    resolvedReferences,
  };
}

/**
 * Deduplicate links targeting the same message
 * Keeps the first occurrence (from newest message)
 */
function deduplicateLinks(
  links: { link: ParsedMessageLink; sourceMessage: Message }[]
): { link: ParsedMessageLink; sourceMessage: Message }[] {
  const seen = new Set<string>();
  return links.filter(({ link }) => {
    if (seen.has(link.messageId)) {
      return false;
    }
    seen.add(link.messageId);
    return true;
  });
}

/**
 * Resolve links with concurrency limit
 */
async function resolveLinksWithConcurrency(
  links: { link: ParsedMessageLink; sourceMessage: Message }[],
  client: Client,
  concurrencyLimit: number,
  fetchTimeout: number
): Promise<ResolvedLink[]> {
  const results: ResolvedLink[] = [];

  // Process in batches
  for (let i = 0; i < links.length; i += concurrencyLimit) {
    const batch = links.slice(i, i + concurrencyLimit);

    const batchResults = await Promise.all(
      batch.map(async ({ link, sourceMessage }) => {
        try {
          const resolved = await fetchAndFormatMessage(link, client, fetchTimeout);
          if (resolved !== null) {
            return {
              url: link.fullUrl,
              sourceMessageId: sourceMessage.id,
              content: resolved.content,
              author: resolved.author,
              messageId: resolved.messageId,
              authorUsername: resolved.authorUsername,
              timestamp: resolved.timestamp,
            };
          }
        } catch (error) {
          logger.debug(
            { messageId: link.messageId, error: (error as Error).message },
            '[HistoryLinkResolver] Failed to resolve link'
          );
        }
        return null;
      })
    );

    for (const result of batchResults) {
      if (result !== null) {
        results.push(result);
      }
    }
  }

  return results;
}

/**
 * Fetch and format a message from a link
 */
async function fetchAndFormatMessage(
  link: ParsedMessageLink,
  client: Client,
  timeout: number
): Promise<{
  content: string;
  author: string;
  messageId: string;
  authorUsername: string;
  timestamp: string;
} | null> {
  try {
    // Try to get guild from cache first
    const guild = client.guilds.cache.get(link.guildId);

    if (guild === undefined) {
      // Not in cache - bot might not have access
      logger.debug({ guildId: link.guildId }, '[HistoryLinkResolver] Guild not accessible');
      return null;
    }

    // Get channel
    const channel = guild.channels.cache.get(link.channelId);
    if (channel === undefined || !('messages' in channel)) {
      logger.debug(
        { channelId: link.channelId },
        '[HistoryLinkResolver] Channel not accessible or not text-based'
      );
      return null;
    }

    // Fetch message with timeout
    const fetchPromise = channel.messages.fetch(link.messageId);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Fetch timeout')), timeout)
    );

    const message = await Promise.race([fetchPromise, timeoutPromise]);

    // Build content using shared utility
    const { content } = await buildMessageContent(message, {
      includeEmbeds: true,
      includeAttachments: true,
    });

    const author =
      message.member?.displayName ??
      message.author.globalName ??
      message.author.username ??
      'Unknown';

    return {
      content,
      author,
      messageId: message.id,
      authorUsername: message.author.username ?? 'unknown',
      timestamp: message.createdAt.toISOString(),
    };
  } catch (error) {
    logger.debug(
      { messageId: link.messageId, error: (error as Error).message },
      '[HistoryLinkResolver] Failed to fetch message'
    );
    return null;
  }
}

/**
 * Process resolved links: strip URLs from message content and build structured references.
 * Returns both the modified messages and a map of source message ID → StoredReferencedMessage[].
 */
function injectResolvedLinks(
  messages: Message[],
  resolvedLinks: ResolvedLink[]
): { messages: Message[]; resolvedReferences: Map<string, StoredReferencedMessage[]> } {
  const resolvedReferences = new Map<string, StoredReferencedMessage[]>();

  // Build map of URL -> resolved content
  const urlToResolved = new Map<string, ResolvedLink>();
  for (const resolved of resolvedLinks) {
    urlToResolved.set(resolved.url, resolved);
  }

  // Process each message
  for (const msg of messages) {
    const links = MessageLinkParser.parseMessageLinks(msg.content);
    if (links.length === 0) {
      continue;
    }

    let newContent = msg.content;

    for (const link of links) {
      const resolved = urlToResolved.get(link.fullUrl);
      if (resolved !== undefined) {
        // Strip the URL from content (replace with empty string)
        newContent = newContent.replace(link.fullUrl, '');

        // Build structured reference
        const truncatedContent = truncateContent(resolved.content, 500);
        const ref: StoredReferencedMessage = {
          discordMessageId: resolved.messageId,
          authorUsername: resolved.authorUsername,
          authorDisplayName: resolved.author,
          content: truncatedContent,
          timestamp: resolved.timestamp,
          locationContext: '',
        };

        // Group by source message ID
        const existing = resolvedReferences.get(msg.id) ?? [];
        existing.push(ref);
        resolvedReferences.set(msg.id, existing);
      }
    }

    // Clean up whitespace from stripped URLs
    newContent = newContent.replace(/\s+/g, ' ').trim();

    // Update the message content
    if (newContent !== msg.content) {
      Object.defineProperty(msg, 'content', {
        value: newContent,
        writable: true,
        configurable: true,
      });
    }
  }

  return { messages, resolvedReferences };
}

/**
 * Truncate content to a maximum length
 */
function truncateContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.substring(0, maxLength - 3) + '...';
}
