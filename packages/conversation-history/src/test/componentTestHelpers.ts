/**
 * Component-test-only scaffolding for the colocated `*.component.test.ts`
 * suites in this package (`ConversationHistoryService.component.test.ts`,
 * `ConversationSyncService.component.test.ts`).
 *
 * This lives here rather than in `@tzurot/test-utils` because `test-utils`
 * has no dependency on `@tzurot/conversation-history`, while this package
 * dev-depends on `test-utils` — a helper wrapping `getChannelHistoryWindow`
 * placed in `test-utils` would invert turbo's `^build` dependency graph.
 */
import {
  getChannelHistoryWindow,
  type ChannelHistoryWindowParams,
} from '../ConversationHistoryService.js';
import type { TransactionalConversationHistoryClient } from '../ConversationMessageMapper.js';
import type { ConversationMessage } from '@tzurot/common-types/types/conversationMessage';

/**
 * Fetches a channel history window and returns only its `messages`, dropping
 * the window `meta`. Callers that need `meta` keep calling
 * {@link getChannelHistoryWindow} directly.
 */
export async function fetchHistory(
  prisma: TransactionalConversationHistoryClient,
  params: ChannelHistoryWindowParams
): Promise<ConversationMessage[]> {
  return (await getChannelHistoryWindow(prisma, params)).messages;
}
