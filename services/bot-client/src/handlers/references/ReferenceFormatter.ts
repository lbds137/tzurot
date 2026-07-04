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
import { buildDedupedReferenceStub } from '@tzurot/common-types/utils/referenceEnrichment';
import { isForwardedMessage, type ReferenceMetadata } from './types.js';
import { type MessageFormatter } from './MessageFormatter.js';
import { type SnapshotFormatter } from './SnapshotFormatter.js';

const logger = createLogger('ReferenceFormatter');

/**
 * Formatted reference result
 */
interface FormattedResult {
  /** Formatted references with numbers assigned */
  references: ReferencedMessage[];
  /** Updated message content with links replaced by [Reference N] */
  updatedContent: string;
  /**
   * Raw pre-enrichment snapshots (only when `collectRaw` was requested):
   * same numbering as `references`, but full content always — no transcript
   * append, no dedup stubbing — so the worker-side assembler can re-run both
   * enrichments itself.
   */
  rawReferences?: ReferencedMessage[];
}

/** Mutable accumulation state threaded through the per-message branch handlers. */
interface FormatState {
  references: ReferencedMessage[];
  rawReferences: ReferencedMessage[];
  collectRaw: boolean;
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
  async format(
    originalContent: string,
    crawledMessages: Map<string, { message: Message; metadata: ReferenceMetadata }>,
    maxReferences: number,
    options: { collectRaw?: boolean } = {}
  ): Promise<FormattedResult> {
    const collectRaw = options.collectRaw === true;
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
    const references: ReferencedMessage[] = [];
    const linkMap = new Map<string, number>(); // Map Discord URL to reference number

    const state: FormatState = { references, rawReferences, collectRaw, linkMap, nextNumber: 1 };
    for (const { message, metadata } of selected) {
      if (metadata.isDeduplicated === true) {
        this.appendDedupedStub(message, metadata, state);
      } else if (isForwardedMessage(message)) {
        this.appendForwardedSnapshots(message, metadata, state);
      } else {
        await this.appendRegular(message, metadata, state);
      }
    }

    // Replace links in content
    const updatedContent = MessageLinkParser.replaceLinksWithReferences(originalContent, linkMap);

    logger.info(
      {
        referencesFormatted: references.length,
        linksReplaced: linkMap.size,
      },
      'Formatting complete'
    );

    return {
      references,
      updatedContent,
      ...(collectRaw && { rawReferences }),
    };
  }

  /** Deduped: enriched side gets a stub; raw side gets the full snapshot. */
  private appendDedupedStub(message: Message, metadata: ReferenceMetadata, s: FormatState): void {
    // Build the full raw snapshot first and derive the stub from it via the
    // shared kernel — the same stub the worker-side assembler produces when
    // its own dedup re-run agrees, so the two shapes cannot drift.
    const raw = this.messageFormatter.buildRawReference(message, s.nextNumber).reference;
    s.references.push(buildDedupedReferenceStub(raw));
    if (s.collectRaw) {
      // The raw side never stubs: the worker re-derives dedup against its
      // OWN hydrated history, so it needs the full pre-dedup snapshot.
      s.rawReferences.push(raw);
    }
    this.trackLink(metadata, s.nextNumber, s.linkMap);
    s.nextNumber++;
  }

  /** Forwarded: each snapshot becomes a reference; raw = enriched (no DB enrichment). */
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
      s.references.push(snapshotReference);
      if (s.collectRaw) {
        s.rawReferences.push({ ...snapshotReference });
      }
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

  /** Regular: enriched (transcripts appended) + raw pre-enrichment snapshot. */
  private async appendRegular(
    message: Message,
    metadata: ReferenceMetadata,
    s: FormatState
  ): Promise<void> {
    const { enriched, raw } = await this.messageFormatter.formatMessageWithRaw(
      message,
      s.nextNumber
    );
    s.references.push(enriched);
    if (s.collectRaw) {
      s.rawReferences.push(raw);
    }
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
