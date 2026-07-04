/**
 * @tzurot/conversation-history
 *
 * Prisma-backed conversation persistence, extracted from `@tzurot/common-types`
 * so the shared type package stays types/schemas/utils:
 *   - `ConversationHistoryService` — channel + cross-channel history retrieval/writes
 *   - `ConversationSyncService` — Discord-edit/delete reconciliation against the DB
 *   - `referenceImageDescriptions` — vision-description persistence on referenced messages
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
  type HistoryTimeFilter,
} from './ConversationHistoryService.js';
export { ConversationRetentionService } from './ConversationRetentionService.js';
export { type ConversationSyncResult, ConversationSyncService } from './ConversationSyncService.js';
export {
  type ConversationHistoryQueryResult,
  conversationHistorySelect,
  conversationRecencyOrderBy,
  mapToConversationMessage,
  mapToConversationMessages,
  parseMessageMetadata,
} from './ConversationMessageMapper.js';
export {
  collectRefImageDescriptions,
  type ReferenceDescriptionScope,
  writeReferenceImageDescriptions,
} from './referenceImageDescriptions.js';
