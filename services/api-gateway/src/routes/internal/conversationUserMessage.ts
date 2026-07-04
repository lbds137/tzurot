/**
 * POST /internal/conversation/user-message
 *
 * Persists the trigger user message before job submission. A user message is
 * a Discord event, so this gateway (the Discord-event data authority) owns
 * the write — bot-client calls it synchronously pre-submission, preserving
 * strict ordering (the next message's history query always sees this row)
 * with no locks. Delegates to ConversationHistoryService.addMessage — the
 * same code path bot-client's legacy direct write uses — so the two paths
 * produce identical rows by construction during the dual-write window.
 *
 * Idempotent: when the row already exists (legacy write is authoritative
 * during dual-write), compares instead of writing and reports `matched`;
 * `matched: false` is the burn-in divergence signal. A create race against
 * the legacy writer (P2002) falls back to compare; other errors surface.
 *
 * **Authentication**: `X-Service-Auth` enforcement happens upstream via the
 * global `requireServiceAuth()` on `/internal/*` in api-gateway's index.
 */

import { type Response, type RequestHandler } from 'express';
import { MessageRole } from '@tzurot/common-types/constants/message';
import {
  PersistUserMessageRequestSchema,
  type PersistUserMessageResponse,
} from '@tzurot/common-types/schemas/api/internal';
import { generateConversationHistoryUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { ConversationHistoryService } from '@tzurot/conversation-history';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { classifyDbTimeout } from '../../utils/dbTimeout.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('internal-conversation-user-message');

/** POST /api/internal/conversation/user-message — persist the trigger user message. */
export const handlePersistUserMessage = (deps: RouteDeps): RequestHandler => {
  // Run the persist on the dedicated fast pool (tight, self-labeling timeouts);
  // fall back to the main pool if the gateway didn't build a fast client.
  const prisma = deps.fastPrisma ?? deps.prisma;
  const historyService = new ConversationHistoryService(prisma);

  return asyncHandler(async (req, res: Response) => {
    const parseResult = PersistUserMessageRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }
    const { channelId, guildId, personalityId, personaId, content, discordMessageId } =
      parseResult.data;
    const messageMetadata = parseResult.data.messageMetadata;

    // The row's createdAt is the Discord message timestamp (preserves the
    // user < assistant(+1ms) ordering invariant); the deterministic UUID is
    // a pure function of what the gateway persists.
    const createdAt = new Date(parseResult.data.messageTime);
    const id = generateConversationHistoryUuid(channelId, personalityId, personaId, createdAt);

    const compareExisting = async (): Promise<PersistUserMessageResponse | null> => {
      const existing = await prisma.conversationHistory.findUnique({
        where: { id },
        select: { content: true, discordMessageId: true },
      });
      if (existing === null) {
        return null;
      }
      // Deliberately lightweight: content + trigger id only. Both write paths
      // construct messageMetadata from the same bot-side object, so metadata
      // divergence could only come from serialization differences — not worth
      // a deep JSONB comparison for the burn-in signal.
      const matched =
        existing.content === content && existing.discordMessageId[0] === discordMessageId;
      if (!matched) {
        logger.warn(
          { id, channelId, contentMatch: existing.content === content },
          'User-message dual-write DIVERGED from existing row'
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
        role: MessageRole.User,
        content,
        guildId,
        discordMessageId,
        messageMetadata,
        timestamp: createdAt,
      });
    } catch (error) {
      // Only the unique-violation race gets the compare fallback (the legacy
      // writer landed between our existence check and the create); any other
      // failure must surface rather than be masked by a coincidental row.
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
            'User-message persist hit a fast-pool DB timeout'
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

    logger.debug({ id, channelId }, 'User message persisted');
    sendCustomSuccess(res, { id, created: true } satisfies PersistUserMessageResponse);
  });
};
