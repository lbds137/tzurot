/**
 * ConversationMessageMapper
 * Handles data transformation between Prisma records and domain objects
 *
 * Extracted from ConversationHistoryService to eliminate duplication
 * of select objects and mapping logic used in 3+ query methods.
 */

import {
  Prisma,
  createLogger,
  MessageRole,
  messageMetadataSchema,
  type MessageMetadata,
  type ConversationMessage,
} from '@tzurot/common-types';

const logger = createLogger('ConversationMessageMapper');

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
  channelId: true,
  guildId: true,
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
 * Default ordering for conversation-history queries: by createdAt (newest first),
 * with a *stable* `id` tiebreak so the order — and therefore which rows survive a
 * `take` limit — is deterministic when multiple rows share a createdAt timestamp.
 * The tiebreak is for stability, not recency: ids are deterministic UUIDs, not
 * monotonic, so among equal-timestamp rows the order is consistent-but-arbitrary.
 * Without the tiebreak the database breaks ties however it likes, which makes
 * `take`-bounded queries (channel history, cross-channel history) flaky.
 */
export const conversationRecencyOrderBy: Prisma.ConversationHistoryOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

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
    // Channel info for cross-channel history
    channelId: record.channelId,
    guildId: record.guildId,
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
