/**
 * POST /internal/conversation/assistant-message
 *
 * Persists the assistant conversation-history row after bot-client confirms
 * Discord delivery. The gateway owns the write: it derives the assistant
 * timestamp (user message + 1ms — preserves chronological ordering), the
 * deterministic row UUID, and the token count. Delegates the create to
 * ConversationHistoryService.addMessage — the SAME code path bot-client's
 * legacy direct write uses — so the two paths produce identical rows by
 * construction during the dual-write window.
 *
 * Idempotent: when the row already exists (bot-client's legacy write is
 * authoritative during dual-write and normally lands first), this handler
 * compares instead of writing and reports `matched` — a `false` there is the
 * burn-in divergence signal.
 *
 * **Authentication**: `X-Service-Auth` enforcement happens upstream via the
 * global `requireServiceAuth()` on `/internal/*` in api-gateway's index.
 */

import { type Response, type RequestHandler } from 'express';
import { MessageRole } from '@tzurot/common-types/constants/message';
import {
  PersistAssistantMessageRequestSchema,
  type PersistAssistantMessageResponse,
} from '@tzurot/common-types/schemas/api/internal';
import { generateConversationHistoryUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { ConversationHistoryService } from '@tzurot/conversation-history';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { classifyDbTimeout } from '../../utils/dbTimeout.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('internal-conversation-assistant-message');

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
    const { channelId, guildId, personalityId, personaId, content, chunkMessageIds } =
      parseResult.data;

    // Assistant timestamp: user message + 1ms (chronological ordering).
    // Derived here, not client-side, so the deterministic UUID below is a
    // pure function of what the gateway persists.
    const assistantTime = new Date(new Date(parseResult.data.userMessageTime).getTime() + 1);
    const id = generateConversationHistoryUuid(channelId, personalityId, personaId, assistantTime);

    const compareExisting = async (): Promise<PersistAssistantMessageResponse | null> => {
      const existing = await prisma.conversationHistory.findUnique({
        where: { id },
        select: { content: true, discordMessageId: true },
      });
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
          'Assistant-message dual-write DIVERGED from existing row'
        );
      }
      return { id, created: false, matched };
    };

    const preExisting = await compareExisting();
    if (preExisting !== null) {
      sendCustomSuccess(res, preExisting);
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
      });
    } catch (error) {
      // Only the unique-violation race gets the compare fallback: the legacy
      // writer landed between our existence check and the create, so the row
      // exists and comparing is the correct outcome. Any other failure
      // (FK violation, transient DB error) must surface, not be masked by a
      // coincidental row appearing in the same window.
      const isRace = (error as { code?: string }).code === 'P2002';
      if (!isRace) {
        // Self-label a fast-pool timeout for the prod diagnostic before
        // rethrowing (asyncHandler turns it into the gateway's 5xx).
        const timeout = classifyDbTimeout(error);
        if (timeout.label !== 'other') {
          logger.error(
            {
              label: timeout.label,
              sqlstate: timeout.sqlstate,
              durationMs: Date.now() - startedAt,
              channelId,
              id,
            },
            'Assistant-message persist hit a fast-pool DB timeout'
          );
        }
        throw error;
      }
      const raced = await compareExisting();
      if (raced !== null) {
        sendCustomSuccess(res, raced);
        return;
      }
      throw error;
    }

    logger.debug(
      { id, channelId, chunkCount: chunkMessageIds.length },
      'Assistant message persisted'
    );
    sendCustomSuccess(res, { id, created: true } satisfies PersistAssistantMessageResponse);
  });
};
