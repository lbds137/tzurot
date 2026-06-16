/**
 * Pure comparison helpers for opportunistic conversation sync.
 *
 * Shared by ConversationSyncService.runSync (api-gateway's sync endpoint and
 * bot-client's legacy direct path both delegate to it), so the edit/delete
 * detection algorithm has exactly one implementation. Operates on plain
 * observed-message shapes — no discord.js types — because the gateway sees
 * only the snapshot bot-client POSTs.
 */

import { createLogger } from '../utils/logger.js';
import { normalizeMessageForContext } from '../utils/discord.js';

const logger = createLogger('conversationSyncDiff');

/**
 * A Discord message as observed by bot-client at fetch time — the minimal
 * fields the sync diff needs.
 */
export interface ObservedSyncMessage {
  /** Discord message ID (snowflake). */
  id: string;
  /** Raw Discord content. May be empty (e.g. voice messages). */
  content: string;
  createdAt: Date;
}

/**
 * Collate message chunks and prepare content for sync.
 * Returns the collated content, or null if sync should be skipped.
 *
 * @param dbId - Database message ID (for logging)
 * @param dbMsg - Database message record
 * @param chunks - Observed Discord chunks belonging to this record
 * @returns Collated content string, or null to skip this sync
 */
export function collateChunksForSync(
  dbId: string,
  dbMsg: { discordMessageId: string[]; content: string },
  chunks: { id: string; content: string }[]
): string | null {
  // SAFEGUARD: Skip sync if we don't have all expected chunks
  // This prevents overwriting good data when Discord API returns partial results
  const expectedChunkCount = dbMsg.discordMessageId.length;
  if (chunks.length < expectedChunkCount) {
    logger.warn(
      {
        messageId: dbId,
        expectedChunks: expectedChunkCount,
        fetchedChunks: chunks.length,
      },
      'Skipping sync - missing chunks from Discord fetch'
    );
    return null;
  }

  // Sort chunks by their order in the DB's discordMessageId array
  const orderMap = new Map(dbMsg.discordMessageId.map((id, idx) => [id, idx]));
  const sortedChunks = [...chunks].sort(
    (a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0)
  );

  // Concatenate all chunk contents
  let collatedContent = sortedChunks.map(c => c.content).join('');

  // Strip bot-added display elements that are NOT stored in the database via the
  // single canonical normalizer (DM/relay prefix, then `-#` footers). Routing
  // through `normalizeMessageForContext` keeps this path in lockstep with the
  // live Discord fetch (`DiscordChannelFetcher`) so the strip steps can't drift.
  collatedContent = normalizeMessageForContext(collatedContent);

  // SAFEGUARD: Skip sync if stripping left us with significantly less content
  // This protects against cases where footer stripping is too aggressive
  // or Discord returned corrupt/empty messages for some chunks
  const originalDbLength = dbMsg.content.length;
  if (originalDbLength > 50 && collatedContent.length < originalDbLength * 0.2) {
    logger.warn(
      {
        messageId: dbId,
        originalLength: originalDbLength,
        newLength: collatedContent.length,
      },
      'Skipping sync - content would shrink by >80%'
    );
    return null;
  }

  return collatedContent;
}

/**
 * Check if two message contents differ significantly.
 * Handles the case where DB content may have display name prefix.
 */
export function contentsDiffer(discordContent: string, dbContent: string): boolean {
  // Direct comparison first
  if (discordContent === dbContent) {
    return false;
  }

  // Never overwrite non-empty DB content with empty Discord content
  // This protects voice message transcripts (Discord shows empty, DB has transcript)
  if (discordContent.length === 0 && dbContent.length > 0) {
    return false;
  }

  // Check if DB content is the Discord content with a [Name]: prefix
  // Pattern: [DisplayName]: <actual content>
  const prefixRegex = /^\[.+?\]: (.*)$/s;
  const prefixMatch = prefixRegex.exec(dbContent);
  if (prefixMatch !== null) {
    const dbContentWithoutPrefix = prefixMatch[1];
    if (discordContent === dbContentWithoutPrefix) {
      return false; // Same content, just has display name prefix
    }
  }

  // Contents actually differ
  return true;
}

/**
 * Get the oldest timestamp from a set of observed messages.
 */
export function getOldestObservedTimestamp(messages: ObservedSyncMessage[]): Date | null {
  let oldest: Date | null = null;
  for (const msg of messages) {
    if (oldest === null || msg.createdAt < oldest) {
      oldest = msg.createdAt;
    }
  }
  return oldest;
}
