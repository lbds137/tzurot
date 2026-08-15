/**
 * Shared pieces of the two conversation-event persist routes
 * (user-message / assistant-message).
 *
 * Both routes are idempotent against REPLAYS: the row id is a deterministic
 * UUID over (channel, personality, persona, timestamp) with a stable
 * timestamp, so an at-least-once redelivery of the same event — a bot-client
 * retry, or MultiTagRecovery re-running a delivery after a deploy-orphan
 * rehydration — resolves to the same id, and the handler compares instead of
 * writing. The compare happens twice per request: an existence pre-check, and
 * a re-read when the create loses a duplicate-delivery race (P2002).
 */

import { type ConversationHistoryClient } from '@tzurot/conversation-history';
import { type createLogger } from '@tzurot/common-types/utils/logger';
import { logFastPoolTimeout } from '../../utils/dbTimeout.js';

/** The columns the persist routes compare a replay against. */
export interface ExistingConversationRow {
  content: string;
  discordMessageId: string[];
  /**
   * Selected for drift REPORTING only — deliberately not part of the `matched`
   * verdict. The column is write-once, so a replay carrying a different trace
   * than the stored row cannot overwrite it; without a log line that trace
   * would be dropped with no signal anywhere, which is the failure the
   * assistant route's warn covers.
   */
  thinkingContent: string | null;
}

/**
 * Fetch the existing row for a persist id, self-labeling a fast-pool timeout
 * before rethrowing — the same `{label, sqlstate, durationMs}` diagnostic the
 * write path logs, so a read-side failure never surfaces as a generic
 * unhandled error.
 */
export async function fetchExistingConversationRow(
  prisma: ConversationHistoryClient,
  id: string,
  logger: ReturnType<typeof createLogger>,
  message: string,
  logFields: Record<string, unknown>
): Promise<ExistingConversationRow | null> {
  const startedAt = Date.now();
  try {
    return await prisma.conversationHistory.findUnique({
      where: { id },
      select: { content: true, discordMessageId: true, thinkingContent: true },
    });
  } catch (error) {
    logFastPoolTimeout(
      logger,
      error,
      { durationMs: Date.now() - startedAt, id, ...logFields },
      message
    );
    throw error;
  }
}
