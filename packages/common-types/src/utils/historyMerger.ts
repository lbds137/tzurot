/**
 * History Merger
 *
 * Functions for merging extended context messages with database conversation history.
 * Extracted from DiscordChannelFetcher.ts for better modularity.
 */

import { createLogger } from './logger.js';
import { NO_TEXT_CONTENT_PLACEHOLDER } from '../constants/message.js';
import type { ConversationMessage } from '../services/ConversationMessageMapper.js';

const logger = createLogger('HistoryMerger');

/**
 * Recover empty DB message content from extended context.
 * Handles cases where voice messages were stored but content was cleared by a bug.
 */
export function recoverEmptyDbContent(
  dbHistory: ConversationMessage[],
  extendedMessageMap: Map<string, ConversationMessage>
): number {
  let recoveredCount = 0;
  for (const dbMsg of dbHistory) {
    const dbContent = dbMsg.content ?? '';
    // A row poisoned by the forwarded-content-loss bug is stored as the
    // placeholder sentinel (not an empty string), so a length check alone
    // would treat it as "has content" and skip recovery. Treat the sentinel
    // as empty so live extended context can re-heal it in-memory.
    if (dbContent.length > 0 && dbContent !== NO_TEXT_CONTENT_PLACEHOLDER) {
      continue;
    } // Has real content, no recovery needed

    const msgId = dbMsg.discordMessageId[0];
    if (msgId === undefined) {
      continue;
    } // No message ID to look up

    const extendedMsg = extendedMessageMap.get(msgId);
    const extendedContent = extendedMsg?.content ?? '';
    // The extended copy is only a valid recovery source if it carries real
    // text. A placeholder-valued extended copy would otherwise "heal"
    // placeholder → placeholder and falsely bump recoveredCount.
    if (extendedContent.length === 0 || extendedContent === NO_TEXT_CONTENT_PLACEHOLDER) {
      continue;
    } // Extended context absent or itself the placeholder — not a recovery source

    // Extended context has content (likely from bot transcript fallback) - use it
    dbMsg.content = extendedContent;
    // Also copy over voice transcripts if available
    if (extendedMsg?.messageMetadata?.voiceTranscripts !== undefined) {
      dbMsg.messageMetadata = dbMsg.messageMetadata ?? {};
      dbMsg.messageMetadata.voiceTranscripts = extendedMsg.messageMetadata.voiceTranscripts;
    }
    recoveredCount++;
    logger.info(
      { messageId: msgId, contentLength: extendedContent.length },
      'Recovered empty DB message content from extended context'
    );
  }
  return recoveredCount;
}

/**
 * Enrich DB messages with extended context metadata (reactions, embeds).
 * Reactions are only available from live Discord fetch, not stored in DB.
 */
export function enrichDbMessagesWithExtendedMetadata(
  dbHistory: ConversationMessage[],
  extendedMessageMap: Map<string, ConversationMessage>
): number {
  let reactionsEnrichedCount = 0;
  for (const dbMsg of dbHistory) {
    const msgId = dbMsg.discordMessageId[0];
    if (msgId === undefined) {
      continue;
    }

    const extendedMsg = extendedMessageMap.get(msgId);
    if (extendedMsg === undefined) {
      continue;
    }

    // Copy reactions from extended context to DB message
    if (extendedMsg.messageMetadata?.reactions !== undefined) {
      dbMsg.messageMetadata = dbMsg.messageMetadata ?? {};
      dbMsg.messageMetadata.reactions = extendedMsg.messageMetadata.reactions;
      reactionsEnrichedCount++;
    }

    // Copy embeds from extended context if not already present
    if (
      extendedMsg.messageMetadata?.embedsXml !== undefined &&
      dbMsg.messageMetadata?.embedsXml === undefined
    ) {
      dbMsg.messageMetadata = dbMsg.messageMetadata ?? {};
      dbMsg.messageMetadata.embedsXml = extendedMsg.messageMetadata.embedsXml;
    }

    // Copy isForwarded flag from extended context (safety net for pre-persistence data)
    // New messages persist isForwarded in messageMetadata via ConversationPersistence
    if (extendedMsg.isForwarded === true && dbMsg.isForwarded !== true) {
      dbMsg.isForwarded = true;
    }
  }

  if (reactionsEnrichedCount > 0) {
    logger.debug(
      { reactionsEnrichedCount },
      'Enriched DB messages with reactions from extended context'
    );
  }
  return reactionsEnrichedCount;
}

/**
 * TEMPORARY diagnostic (debug PR): build a PII-safe descriptor of a message
 * for the context-merge probe. Logs derived booleans/lengths/IDs only — never
 * raw content (per the no-PII-in-logs rule). Used to root-cause the beta.133
 * context-assembly trio (footer leak / chime-in role+order / blank image msgs):
 * which copy of a message survives the live-vs-DB merge, and with what shape.
 * Gated behind CTX_MERGE_PROBE=1; remove with the cleanup commit once read.
 */
function ctxProbeDescriptor(
  m: ConversationMessage,
  dbIds: { has: (id: string) => boolean }
): Record<string, unknown> {
  const content = m.content ?? '';
  const id = m.discordMessageId[0];
  const meta = m.messageMetadata;
  return {
    id: id ?? null,
    role: String(m.role),
    pName: m.personalityName ?? null,
    len: content.length,
    ph: content === NO_TEXT_CONTENT_PLACEHOLDER,
    ftr: content.includes('-# '), // Discord subtext footer (Bug A)
    relay: /^\*\*[^*]+:\*\*\s/.test(content), // "**Name:** …" relay-echo shape (Bug B)
    fwd: m.isForwarded === true,
    // metadata presence (Bug C — is there ANY attachment description to render?)
    aDesc: meta?.attachmentDescriptions?.length ?? 0,
    emb: meta?.embedsXml?.length ?? 0,
    voc: meta?.voiceTranscripts?.length ?? 0,
    fAtt: meta?.forwardedAttachmentLines?.length ?? 0,
    rx: meta?.reactions?.length ?? 0,
    // for live messages: does a DB row already cover this id (→ deduped out)?
    inDb: id !== undefined ? dbIds.has(id) : false,
  };
}

/**
 * Collapse DB-history rows that represent the SAME Discord message.
 *
 * `conversation_history` rows are personality-scoped and there is no unique
 * constraint on `discordMessageId`, so a single Discord message that triggered
 * N personalities (a user's @-ping to multiple characters in one channel) is
 * stored as N rows sharing the same `discordMessageId`. `getChannelHistory` is
 * channel-scoped — it fetches ALL personalities' rows — so every duplicate
 * comes back, and the merge would otherwise surface that one user turn N times
 * in the model context.
 *
 * Collapsing by shared id only ever removes TRUE duplicates: distinct Discord
 * messages never share a snowflake, and each character's own reply is its own
 * Discord message with its own id, so assistant turns are never collapsed —
 * only a shared trigger that was fanned out across personalities. Keeps the
 * first occurrence (the caller supplies rows already in chronological order).
 */
function dedupeDbHistoryByMessageId(dbHistory: ConversationMessage[]): ConversationMessage[] {
  const seenIds = new Set<string>();
  const deduped: ConversationMessage[] = [];
  let droppedCount = 0;
  for (const msg of dbHistory) {
    if (msg.discordMessageId.some(id => seenIds.has(id))) {
      droppedCount++;
      continue;
    }
    for (const id of msg.discordMessageId) {
      seenIds.add(id);
    }
    deduped.push(msg);
  }
  if (droppedCount > 0) {
    logger.debug(
      { droppedCount, originalCount: dbHistory.length },
      'Collapsed duplicate channel-history rows sharing a Discord message id'
    );
  }
  return deduped;
}

/**
 * Merge extended context messages with database conversation history
 *
 * This handles deduplication when the same message appears in both sources.
 * Priority: DB history (more complete metadata) > Discord fetch
 *
 * @param extendedMessages - Messages from Discord channel fetch
 * @param dbHistory - Messages from database conversation history (chronological order)
 * @returns Merged and deduplicated message list in chronological order (oldest first)
 */
export function mergeWithHistory(
  extendedMessages: ConversationMessage[],
  dbHistory: ConversationMessage[]
): ConversationMessage[] {
  // Collapse same-Discord-message duplicate rows FIRST. A user's @-ping to
  // multiple characters is persisted once per responding personality (rows are
  // personality-scoped, no unique constraint on discordMessageId), and the
  // channel-scoped getChannelHistory returns all of them — without this the
  // merge would surface that one user turn N times. See dedupeDbHistoryByMessageId.
  const dedupedDbHistory = dedupeDbHistoryByMessageId(dbHistory);

  // Build map of message IDs to DB messages for deduplication and content comparison
  const dbMessageMap = new Map<string, ConversationMessage>();
  for (const msg of dedupedDbHistory) {
    for (const id of msg.discordMessageId) {
      dbMessageMap.set(id, msg);
    }
  }

  // Build map of extended context messages by ID for content recovery
  const extendedMessageMap = new Map<string, ConversationMessage>();
  for (const msg of extendedMessages) {
    const msgId = msg.discordMessageId[0];
    if (msgId !== undefined) {
      extendedMessageMap.set(msgId, msg);
    }
  }

  // Recover empty DB content from extended context
  const recoveredCount = recoverEmptyDbContent(dedupedDbHistory, extendedMessageMap);

  // Enrich DB messages with extended context metadata (reactions, embeds)
  enrichDbMessagesWithExtendedMetadata(dedupedDbHistory, extendedMessageMap);

  // Filter extended messages to exclude those already in DB history
  const uniqueExtendedMessages = extendedMessages.filter(msg => {
    const msgId = msg.discordMessageId[0];
    return !dbMessageMap.has(msgId);
  });

  logger.debug(
    {
      extendedCount: extendedMessages.length,
      dbHistoryCount: dedupedDbHistory.length,
      dbHistoryDuplicatesDropped: dbHistory.length - dedupedDbHistory.length,
      uniqueExtendedCount: uniqueExtendedMessages.length,
      deduplicatedCount: extendedMessages.length - uniqueExtendedMessages.length,
      recoveredCount,
    },
    'Merged extended context with DB history'
  );

  // Combine: DB history (chronological, richer metadata) + unique extended messages
  const merged = [...dedupedDbHistory, ...uniqueExtendedMessages];

  // Sort by timestamp ascending (oldest first = chronological order)
  // This ensures newest messages appear last in the prompt, getting
  // more attention from LLMs due to recency bias in attention mechanisms
  merged.sort((a, b) => {
    const timeA =
      a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
    const timeB =
      b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
    return timeA - timeB;
  });

  // TEMPORARY diagnostic (debug PR, CTX_MERGE_PROBE=1): dump PII-safe descriptors for
  // the most-recent slice of the FINAL merged result — i.e. exactly the recent window
  // the prompt will render. Logging `merged` (which IS sorted oldest-first) rather than
  // the raw `extendedMessages` array (newest-first from the Discord fetch) avoids the
  // window-direction trap. `inDb` reveals whether each entry is DB-sourced (clean) or a
  // unique live copy that leaked through dedup. This is the single boundary where the
  // beta.133 context trio converges (footer leak / chime-in role+order / blank image
  // msgs). Remove with the cleanup commit once the mechanism is read.
  if (process.env.CTX_MERGE_PROBE === '1') {
    const TAIL = 25;
    logger.info(
      {
        probe: 'ctx-merge',
        dbCount: dbHistory.length,
        liveCount: extendedMessages.length,
        survivedLive: uniqueExtendedMessages.length,
        mergedCount: merged.length,
        recent: merged.slice(-TAIL).map(m => ctxProbeDescriptor(m, dbMessageMap)),
      },
      '[CTX-MERGE-PROBE]'
    );
  }

  return merged;
}
