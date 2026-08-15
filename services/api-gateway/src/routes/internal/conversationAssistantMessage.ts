/**
 * POST /api/internal/conversation/assistant-message
 *
 * Persists the assistant conversation-history row after bot-client confirms
 * Discord delivery. The gateway owns the write: it derives the assistant
 * timestamp (user message + 1ms — preserves chronological ordering), the
 * deterministic row UUID, and the token count. This endpoint is the SOLE
 * creator of assistant history rows (bot-client has no Prisma; ai-worker
 * only updates existing rows).
 *
 * Idempotent against replays (see conversationPersistShared.ts): an
 * at-least-once redelivery — a retry, or MultiTagRecovery re-running a
 * delivery after deploy-orphan rehydration — resolves to the same
 * deterministic id, so this handler compares instead of writing and reports
 * `matched`; a `false` there means the replay carried different content
 * (drift between attempts), which is a bug signal.
 *
 * **Authentication**: `X-Service-Auth` enforcement happens upstream via the
 * global `requireServiceAuth()` on `/internal/*` in api-gateway's index.
 */

import { type Response, type RequestHandler } from 'express';
import { MessageRole, ASSISTANT_ROW_OFFSET_MS } from '@tzurot/common-types/constants/message';
import {
  PersistAssistantMessageRequestSchema,
  PersistAssistantMessageResponseSchema,
  type PersistAssistantMessageResponse,
} from '@tzurot/common-types/schemas/api/internal';
import { generateConversationHistoryUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { ConversationHistoryService } from '@tzurot/conversation-history';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendContractSuccess } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { logFastPoolTimeout } from '../../utils/dbTimeout.js';
import { fetchExistingConversationRow } from './conversationPersistShared.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('internal-conversation-assistant-message');

/**
 * Warn when a replay carries a reasoning trace that differs from the stored
 * row's.
 *
 * Reported separately from `matched`, and deliberately NOT folded into it: the
 * common shape is benign (the first attempt captured no trace, a retry did), so
 * failing the replay would reclassify an ordinary retry as a drift bug. But the
 * column is write-once, so the incoming trace is discarded either way — and
 * without this line that discard is invisible, which defeats the point of a
 * column whose whole purpose is that a trace survives.
 */
function warnOnTraceDrift(
  stored: string | null,
  incoming: string | undefined,
  fields: { id: string; channelId: string }
): void {
  // Normalize the incoming value the SAME way the write path does before
  // comparing. `addMessage` stores '' as null, so a stored "no trace" row always
  // reads back as null — comparing a raw '' against it would report drift
  // between two values that mean the identical thing, on a log line whose only
  // job is to be a trustworthy signal.
  const normalizedIncoming = incoming === '' ? null : incoming;
  if (normalizedIncoming === undefined || normalizedIncoming === stored) {
    return;
  }
  logger.warn(
    {
      ...fields,
      storedLength: stored?.length ?? 0,
      incomingLength: normalizedIncoming?.length ?? 0,
      storedWasNull: stored === null,
    },
    'Assistant-message replay carried a different reasoning trace — discarded (column is write-once)'
  );
}

function chunkIdsMatch(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, idx) => id === b[idx]);
}

/** POST /api/internal/conversation/assistant-message — persist a delivered assistant turn. */
export const handlePersistAssistantMessage = (deps: RouteDeps): RequestHandler => {
  // Run the persist on the dedicated fast pool (tight, self-labeling timeouts);
  // fall back to the main pool if the gateway didn't build a fast client.
  const prisma = deps.fastPrisma ?? deps.prisma;
  const historyService = new ConversationHistoryService(prisma);

  return asyncHandler(async (req, res: Response) => {
    const parseResult = PersistAssistantMessageRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }
    const {
      channelId,
      guildId,
      personalityId,
      personaId,
      content,
      chunkMessageIds,
      thinkingContent,
    } = parseResult.data;

    // Assistant timestamp: user message + 1ms (chronological ordering).
    // Derived here, not client-side, so the deterministic UUID below is a
    // pure function of what the gateway persists.
    const assistantTime = new Date(
      new Date(parseResult.data.userMessageTime).getTime() + ASSISTANT_ROW_OFFSET_MS
    );
    const id = generateConversationHistoryUuid(channelId, personalityId, personaId, assistantTime);

    const compareExisting = async (): Promise<PersistAssistantMessageResponse | null> => {
      const existing = await fetchExistingConversationRow(
        prisma,
        id,
        logger,
        'Assistant-message existence check hit a fast-pool DB timeout',
        { channelId }
      );
      if (existing === null) {
        return null;
      }
      const matched =
        existing.content === content && chunkIdsMatch(existing.discordMessageId, chunkMessageIds);
      if (!matched) {
        logger.warn(
          {
            id,
            channelId,
            contentMatch: existing.content === content,
            chunkIdsMatch: chunkIdsMatch(existing.discordMessageId, chunkMessageIds),
          },
          'Assistant-message persist replay DIVERGED from existing row'
        );
      }
      warnOnTraceDrift(existing.thinkingContent, thinkingContent, { id, channelId });
      return { id, created: false, matched };
    };

    const preExisting = await compareExisting();
    if (preExisting !== null) {
      sendContractSuccess(res, PersistAssistantMessageResponseSchema, preExisting);
      return;
    }

    const startedAt = Date.now();
    try {
      await historyService.addMessage({
        channelId,
        personalityId,
        personaId,
        role: MessageRole.Assistant,
        content,
        guildId,
        discordMessageId: chunkMessageIds,
        timestamp: assistantTime,
        thinkingContent,
      });
    } catch (error) {
      // Only the unique-violation race gets the compare fallback: a duplicate
      // delivery of the same event landed between our existence check and the
      // create, so the row exists and comparing is the correct outcome. Any
      // other failure (FK violation, transient DB error) must surface, not be
      // masked by a coincidental row appearing in the same window.
      const isRace = (error as { code?: string }).code === 'P2002';
      if (!isRace) {
        // Classify before rethrowing so the resulting 5xx carries the
        // {label, sqlstate} diagnostic in the logs instead of a generic error.
        logFastPoolTimeout(
          logger,
          error,
          { durationMs: Date.now() - startedAt, channelId, id },
          'Assistant-message persist hit a fast-pool DB timeout'
        );
        throw error;
      }
      const raced = await compareExisting();
      if (raced !== null) {
        sendContractSuccess(res, PersistAssistantMessageResponseSchema, raced);
        return;
      }
      throw error;
    }

    logger.debug(
      { id, channelId, chunkCount: chunkMessageIds.length },
      'Assistant message persisted'
    );
    sendContractSuccess(res, PersistAssistantMessageResponseSchema, {
      id,
      created: true,
    } satisfies PersistAssistantMessageResponse);
  });
};
