/**
 * ConversationMessageMapper
 * Handles data transformation between Prisma records and domain objects
 *
 * Extracted from ConversationHistoryService to eliminate duplication
 * of select objects and mapping logic used in 3+ query methods.
 */

import { Prisma } from './prisma.js';
import { createLogger } from '../utils/logger.js';
import { MessageRole } from '../constants/index.js';
import { messageMetadataSchema, type MessageMetadata } from '../types/schemas/index.js';

const logger = createLogger('ConversationMessageMapper');

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  tokenCount?: number; // Cached token count (computed once, reused on every request)
  createdAt: Date;
  personaId: string;
  personaName?: string; // The user's persona name for display in context
  discordUsername?: string; // Discord username for disambiguation when persona name matches personality name
  discordMessageId: string[]; // Discord snowflake IDs for chunked messages (deduplication)
  isForwarded?: boolean; // Whether this message was forwarded from another channel
  messageMetadata?: MessageMetadata; // Structured metadata (referenced messages, attachments)
  // AI personality info (for multi-AI channel attribution)
  personalityId?: string; // The AI personality this message belongs to
  personalityName?: string; // The AI personality's display name (for assistant messages)
}

/**
 * Prisma select object for conversation history queries
 * Includes persona and owner relations for name resolution
 */
export const conversationHistorySelect = {
  id: true,
  role: true,
  content: true,
  tokenCount: true,
  createdAt: true,
  personaId: true,
  personalityId: true,
  discordMessageId: true,
  messageMetadata: true,
  persona: {
    select: {
      name: true,
      preferredName: true,
      owner: {
        select: {
          username: true,
        },
      },
    },
  },
  // Include personality relation for assistant message attribution in multi-AI channels
  personality: {
    select: {
      name: true,
      displayName: true,
    },
  },
} as const satisfies Prisma.ConversationHistorySelect;

/**
 * Type for the raw database result when using conversationHistorySelect
 */
export type ConversationHistoryQueryResult = Prisma.ConversationHistoryGetPayload<{
  select: typeof conversationHistorySelect;
}>;

/**
 * Safely parse messageMetadata from database JSONB column
 * Returns undefined if validation fails (logs warning)
 */
export function parseMessageMetadata(raw: unknown): MessageMetadata | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  const result = messageMetadataSchema.safeParse(raw);
  if (!result.success) {
    logger.warn(
      { errors: result.error.issues },
      '[ConversationMessageMapper] Invalid messageMetadata from database, ignoring'
    );
    return undefined;
  }
  return result.data;
}

/**
 * Map a database query result to a ConversationMessage domain object
 */
export function mapToConversationMessage(
  record: ConversationHistoryQueryResult
): ConversationMessage {
  const metadata = parseMessageMetadata(record.messageMetadata);

  return {
    id: record.id,
    role: record.role as MessageRole,
    content: record.content,
    tokenCount: record.tokenCount ?? undefined,
    createdAt: record.createdAt,
    personaId: record.personaId,
    personaName: record.persona.preferredName ?? record.persona.name,
    discordUsername: record.persona.owner.username,
    discordMessageId: record.discordMessageId,
    isForwarded: metadata?.isForwarded === true ? true : undefined,
    messageMetadata: metadata,
    // AI personality info for multi-AI channel attribution
    personalityId: record.personalityId,
    personalityName: record.personality.displayName ?? record.personality.name,
  };
}

/**
 * Map an array of database query results to ConversationMessage domain objects
 */
export function mapToConversationMessages(
  records: ConversationHistoryQueryResult[]
): ConversationMessage[] {
  return records.map(mapToConversationMessage);
}
