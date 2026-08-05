/**
 * Reference Formatter
 *
 * Handles presentation logic: sorting, numbering, and formatting references
 * Separates view concerns from extraction/traversal logic
 */

import type { Message } from 'discord.js';
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { MessageLinkParser } from '@tzurot/common-types/utils/messageLinkParser';
import { isForwardedMessage, type ReferenceMetadata } from './types.js';
import { type MessageFormatter } from './MessageFormatter.js';
import { type SnapshotFormatter } from './SnapshotFormatter.js';

const logger = createLogger('ReferenceFormatter');

/**
 * Formatted reference result
 */
interface FormattedResult {
  /** Updated message content with links replaced by [Reference N] */
  updatedContent: string;
  /**
   * Raw pre-enrichment snapshots — full content always, no transcript append
   * and no dedup stubbing, so the worker-side assembler can run both
   * enrichments itself. This is the only reference payload that ships.
   */
  rawReferences: ReferencedMessage[];
}

/** Mutable accumulation state threaded through the per-message branch handlers. */
interface FormatState {
  rawReferences: ReferencedMessage[];
  linkMap: Map<string, number>;
  nextNumber: number;
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
  format(
    originalContent: string,
    crawledMessages: Map<string, { message: Message; metadata: ReferenceMetadata }>,
    maxReferences: number
  ): FormattedResult {
    const rawReferences: ReferencedMessage[] = [];
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
        'Limited references to maxReferences'
      );
    }

    // Format messages and assign reference numbers
    const linkMap = new Map<string, number>(); // Map Discord URL to reference number

    const state: FormatState = { rawReferences, linkMap, nextNumber: 1 };
    for (const { message, metadata } of selected) {
      // A deduped reference takes the single-entry path even when it is a
      // forward: no stub is built on this side any more (deduplication is
      // decided and rendered worker-side, against ai-worker's OWN assembled
      // history), so the deduped branch is exactly the regular one — it just
      // must not fan a forward out into one entry per snapshot.
      if (metadata.isDeduplicated !== true && isForwardedMessage(message)) {
        this.appendForwardedSnapshots(message, metadata, state);
      } else {
        this.appendSingleReference(message, metadata, state);
      }
    }

    // Replace links in content
    const updatedContent = MessageLinkParser.replaceLinksWithReferences(originalContent, linkMap);

    logger.info(
      {
        referencesFormatted: rawReferences.length,
        linksReplaced: linkMap.size,
      },
      'Formatting complete'
    );

    return {
      updatedContent,
      rawReferences,
    };
  }

  /** Forwarded: each snapshot becomes its own reference. */
  private appendForwardedSnapshots(
    message: Message & { messageSnapshots: NonNullable<Message['messageSnapshots']> },
    metadata: ReferenceMetadata,
    s: FormatState
  ): void {
    for (const snapshot of message.messageSnapshots.values()) {
      const snapshotReference = this.snapshotFormatter.formatSnapshot(
        snapshot,
        s.nextNumber,
        message
      );
      s.rawReferences.push(snapshotReference);
      // All snapshots of one forward share the crawled entry's discordUrl, and
      // trackLink uses Map.set — so the LAST snapshot's number wins and the
      // [Reference N] link resolves to the forward's final snapshot.
      this.trackLink(metadata, s.nextNumber, s.linkMap);
      s.nextNumber++;

      logger.debug(
        {
          messageId: message.id,
          snapshotContent: snapshot.content?.substring(0, 50),
          referenceNumber: s.nextNumber - 1,
        },
        'Added snapshot from forwarded message'
      );
    }
  }

  /** One reference: the raw pre-enrichment snapshot of the whole message. */
  private appendSingleReference(
    message: Message,
    metadata: ReferenceMetadata,
    s: FormatState
  ): void {
    const raw = this.messageFormatter.buildRawReference(message, s.nextNumber).reference;
    s.rawReferences.push(raw);
    this.trackLink(metadata, s.nextNumber, s.linkMap);
    s.nextNumber++;
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
