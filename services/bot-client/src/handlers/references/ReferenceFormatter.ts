/**
 * Reference Formatter
 *
 * Handles presentation logic: sorting, numbering, and formatting references
 * Separates view concerns from extraction/traversal logic
 */

import type { Message } from 'discord.js';
import { createLogger, type ReferencedMessage, TEXT_LIMITS } from '@tzurot/common-types';
import { MessageLinkParser } from '../../utils/MessageLinkParser.js';
import { isForwardedMessage, type ReferenceMetadata } from './types.js';
import { MessageFormatter } from './MessageFormatter.js';
import { SnapshotFormatter } from './SnapshotFormatter.js';

const logger = createLogger('ReferenceFormatter');

/**
 * Formatted reference result
 */
interface FormattedResult {
  /** Formatted references with numbers assigned */
  references: ReferencedMessage[];
  /** Updated message content with links replaced by [Reference N] */
  updatedContent: string;
}

/**
 * Formats references for presentation
 */
export class ReferenceFormatter {
  constructor(
    private readonly messageFormatter: MessageFormatter,
    private readonly snapshotFormatter: SnapshotFormatter
  ) {}

  /**
   * Format crawled references for presentation
   * @param originalContent - Original message content
   * @param crawledMessages - Messages collected by crawler with metadata
   * @param maxReferences - Maximum number of references to include
   * @returns Formatted references and updated content
   */
  async format(
    originalContent: string,
    crawledMessages: Map<string, { message: Message; metadata: ReferenceMetadata }>,
    maxReferences: number
  ): Promise<FormattedResult> {
    // Convert to array for sorting
    const messagesArray = Array.from(crawledMessages.values());

    // Sort: depth first (BFS), then chronologically within depth
    messagesArray.sort((a, b) => {
      if (a.metadata.depth !== b.metadata.depth) {
        return a.metadata.depth - b.metadata.depth; // Earlier depth first
      }
      return a.metadata.timestamp.getTime() - b.metadata.timestamp.getTime(); // Older first
    });

    // Apply limit
    const selected = messagesArray.slice(0, maxReferences);

    if (messagesArray.length > maxReferences) {
      logger.info(
        {
          total: messagesArray.length,
          limit: maxReferences,
          depthDistribution: this.countByDepth(selected.map(s => s.metadata)),
        },
        '[ReferenceFormatter] Limited references to maxReferences'
      );
    }

    // Format messages and assign reference numbers
    const references: ReferencedMessage[] = [];
    const linkMap = new Map<string, number>(); // Map Discord URL to reference number
    let currentNumber = 1;

    for (const { message, metadata } of selected) {
      // Deduped stubs: minimal ReferencedMessage with truncated content
      if (metadata.isDeduplicated === true) {
        references.push(this.buildDedupedStub(message, currentNumber));
        this.trackLink(metadata, currentNumber, linkMap);
        currentNumber++;
        continue;
      }

      // Check if this is a forwarded message with snapshots
      if (isForwardedMessage(message)) {
        // Extract each snapshot from the forward as a separate reference
        for (const snapshot of message.messageSnapshots.values()) {
          const snapshotReference = this.snapshotFormatter.formatSnapshot(
            snapshot,
            currentNumber,
            message
          );
          references.push(snapshotReference);
          this.trackLink(metadata, currentNumber, linkMap);
          currentNumber++;

          logger.debug(
            {
              messageId: message.id,
              snapshotContent: snapshot.content?.substring(0, 50),
              referenceNumber: currentNumber - 1,
            },
            '[ReferenceFormatter] Added snapshot from forwarded message'
          );
        }
      } else {
        // Regular message (not a forward)
        const formattedMessage = await this.messageFormatter.formatMessage(message, currentNumber);
        references.push(formattedMessage);
        this.trackLink(metadata, currentNumber, linkMap);
        currentNumber++;
      }
    }

    // Replace links in content
    const updatedContent = MessageLinkParser.replaceLinksWithReferences(originalContent, linkMap);

    logger.info(
      {
        referencesFormatted: references.length,
        linksReplaced: linkMap.size,
      },
      '[ReferenceFormatter] Formatting complete'
    );

    return {
      references,
      updatedContent,
    };
  }

  /** Build a minimal ReferencedMessage for a deduped reference */
  private buildDedupedStub(message: Message, refNumber: number): ReferencedMessage {
    const limit = TEXT_LIMITS.DEDUP_STUB_CONTENT;
    const truncatedContent =
      message.content.length > limit
        ? message.content.substring(0, limit) + '...'
        : message.content;
    return {
      referenceNumber: refNumber,
      discordMessageId: message.id,
      discordUserId: message.author.id,
      authorUsername: message.author.username,
      authorDisplayName: message.author.displayName ?? message.author.username,
      content: truncatedContent,
      embeds: '',
      timestamp: message.createdAt.toISOString(),
      locationContext: '',
      isDeduplicated: true,
    };
  }

  /** Track a Discord link for [Reference N] replacement if present */
  private trackLink(
    metadata: ReferenceMetadata,
    refNumber: number,
    linkMap: Map<string, number>
  ): void {
    if (
      metadata.discordUrl !== undefined &&
      metadata.discordUrl !== null &&
      metadata.discordUrl.length > 0
    ) {
      linkMap.set(metadata.discordUrl, refNumber);
    }
  }

  /**
   * Count references by depth level for logging
   * @param metadata - Array of reference metadata
   * @returns Object mapping depth to count
   */
  private countByDepth(metadata: ReferenceMetadata[]): Record<number, number> {
    const counts: Record<number, number> = {};
    for (const meta of metadata) {
      counts[meta.depth] = (counts[meta.depth] || 0) + 1;
    }
    return counts;
  }
}
