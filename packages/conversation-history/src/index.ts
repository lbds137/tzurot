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
 */

export * from './ConversationHistoryService.js';
export * from './ConversationSyncService.js';
export * from './ConversationMessageMapper.js';
export * from './referenceImageDescriptions.js';
