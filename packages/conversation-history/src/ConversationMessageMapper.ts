/**
 * ConversationMessageMapper
 * Handles data transformation between Prisma records and domain objects
 *
 * Extracted from ConversationHistoryService to eliminate duplication
 * of select objects and mapping logic used in 3+ query methods.
 */

import { type MessageRole } from '@tzurot/common-types/constants/message';
import { type Prisma, type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import {
  messageMetadataSchema,
  type MessageMetadata,
} from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('ConversationMessageMapper');

/**
 * Structural subset of PrismaClient that the conversation-history modules
 * actually use. A full PrismaClient satisfies it — and so does an
 * `$extends`-wrapped client (api-gateway's fast pool with blanket dead-conn
 * retry, `applyFastPoolDeadConnRetry` in `utils/dbTimeout.ts`), which the
 * nominal `PrismaClient` type would force behind an `as unknown as` cast
 * because `$extends` returns a differently-typed client.
 *
 * **This type's NARROWNESS is load-bearing, not incidental.** It is what the
 * fast pool is typed as, and the fast pool carries a blanket retry-once that is
 * safe only for idempotent single-row work. Because `$transaction` is absent
 * here, opening a transaction on that pool fails to compile — see the
 * dedication argument on `applyFastPoolDeadConnRetry`. Do NOT add capabilities
 * to this type to satisfy one consumer; give that consumer its own type, as
 * {@link TransactionalConversationHistoryClient} does.
 */
export type ConversationHistoryClient = Pick<PrismaClient, 'conversationHistory'>;

/**
 * A client that can additionally open an interactive transaction.
 *
 * Separate from {@link ConversationHistoryClient} so that requiring a
 * transaction cannot silently hand the capability to the fast pool. Only the
 * windowed channel read needs it — its count and its rows must come from ONE
 * snapshot — and it asks for it explicitly at its own signature.
 */
export type TransactionalConversationHistoryClient = ConversationHistoryClient &
  Pick<PrismaClient, '$transaction'>;

/**
 * A client that can additionally issue raw SQL.
 *
 * Third member of the same split, and here for the same reason the second one
 * is: `message_metadata` has several writers keying on different fields of one
 * JSON blob, so each must merge server-side rather than read-modify-write.
 * That needs `$executeRaw`, which the fast pool must not have — its blanket
 * retry-once is safe only for idempotent single-row work.
 */
export type RawCapableConversationHistoryClient = ConversationHistoryClient &
  Pick<PrismaClient, '$executeRaw'>;

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
  // Include personality relation for assistant message attribution in multi-AI channels.
  // Only `name` is needed — attribution uses `name`, never displayName
  // (see mapToConversationMessage for why; `name` is more distinguishing but NOT unique).
  personality: {
    select: {
      name: true,
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

/** Inputs to the channel-history predicate. */
export interface ChannelHistoryWhereParams {
  channelId: string;
  /** Resolved `createdAt >=` cutoff, or undefined for no time bound. */
  cutoff?: Date;
  /**
   * A Discord message id to exclude — the turn that triggered the request.
   * Excluded DB-SIDE rather than post-filtered: the window's count and its
   * rows must describe the same set, and a row filtered off afterwards would
   * hand back one message fewer than the arithmetic promised.
   */
  excludeDiscordMessageId?: string;
}

/**
 * The channel-history predicate, built once and used by BOTH the count and the
 * fetch of a windowed read. Sharing the object is the mechanism, not a
 * convenience: two independently-built predicates that drift produce a count
 * over one row set and a window over another, and nothing would detect it.
 *
 * Deliberately NO personalityId filter — channel history is cross-personality.
 */
export function buildChannelHistoryWhere(
  params: ChannelHistoryWhereParams
): Prisma.ConversationHistoryWhereInput {
  const { channelId, cutoff, excludeDiscordMessageId } = params;
  return {
    channelId,
    deletedAt: null,
    ...(cutoff !== undefined ? { createdAt: { gte: cutoff } } : {}),
    ...(excludeDiscordMessageId !== undefined
      ? { NOT: { discordMessageId: { has: excludeDiscordMessageId } } }
      : {}),
  };
}

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
    // AI personality info for multi-AI channel attribution.
    // Use `name`, not `displayName`: two personalities can share a display name
    // (e.g. "Fallen Emily" and "Emily" both displaying "Emily"), which collapses
    // their chat-log attribution into an indistinguishable `from="Emily"`.
    // `name` is the MORE distinguishing of the two, and matches how the active
    // personality is named throughout the prompt.
    //
    // It is NOT unique, despite what this comment used to claim: only `slug`
    // carries a unique constraint (`prisma/schema.prisma`, model Personality).
    // Anything deciding identity must key on `personalityId`, not on this — the
    // "unique name" phrasing here nearly got a real same-name collision
    // dismissed as impossible.
    personalityId: record.personalityId,
    personalityName: record.personality.name,
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
