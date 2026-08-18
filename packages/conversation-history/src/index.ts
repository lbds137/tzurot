/**
 * @tzurot/conversation-history
 *
 * Prisma-backed conversation persistence, extracted from `@tzurot/common-types`
 * so the shared type package stays types/schemas/utils:
 *   - `ConversationHistoryService` — channel + cross-channel history retrieval/writes
 *   - `ConversationSyncService` — Discord-edit/delete reconciliation against the DB
 *   - `triggerReferenceWriter` — durable storage of the references a turn was built from
 *   - `ConversationMessageMapper` — Prisma select + row→domain mapping
 *
 * Per the epic's boundary principle, the LOGIC lives here; shared data SHAPES
 * (`ConversationMessage`, `CrossChannelHistoryGroup`) stay in `@tzurot/common-types`,
 * as does the pure `conversationSyncDiff` util (bot-client consumes it). Consumers
 * construct these services with an injected `PrismaClient` (the apps own their
 * client — see `createPrismaClient` in `@tzurot/common-types`).
 *
 * `ConversationRetentionService` lives here (not in a service) so BOTH the
 * gateway's manual /admin cleanup route and ai-worker's scheduled daily sweep
 * share one implementation without a cross-service import.
 */

export {
  ConversationHistoryService,
  getChannelHistoryWindow,
  type ChannelHistoryWindowParams,
  type ChannelHistoryWindowResult,
} from './ConversationHistoryService.js';
// TransactionalConversationHistoryClient is deliberately NOT re-exported: it is
// the capability the windowed read asks for at its own signature, and every
// external consumer reaches it structurally by passing a real PrismaClient.
// Exporting it would invite a consumer to type a field as "transaction-capable"
// — which is how the narrow type got widened in the first place.
export { type ConversationHistoryClient } from './ConversationMessageMapper.js';
export { mergeForwardedOrigin } from './forwardedOriginWriter.js';
// A free function, not a service method: it merges `message_metadata`
// server-side and so needs `$executeRaw`, which the fast-pool client type
// deliberately lacks. Consumers satisfy the capability structurally by passing
// a real PrismaClient — the same way the transactional read is reached.
export { writeTriggerReferences } from './triggerReferenceWriter.js';
// RawCapableConversationHistoryClient stays unexported for the same reason
// TransactionalConversationHistoryClient does: the raw-SQL capability is asked
// for at the one signature that needs it, not offered to every consumer.
export { ConversationRetentionService } from './ConversationRetentionService.js';
export { ConversationSyncService } from './ConversationSyncService.js';
export { propagateDeletionToFacts } from './memoryDeletionPropagation.js';
