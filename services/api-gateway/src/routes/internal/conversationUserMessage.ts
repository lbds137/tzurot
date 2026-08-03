/**
 * POST /api/internal/conversation/user-message
 *
 * Persists the trigger user message before job submission. A user message is
 * a Discord event, so this gateway (the Discord-event data authority) owns
 * the write — bot-client calls it synchronously pre-submission, preserving
 * strict ordering (the next message's history query always sees this row)
 * with no locks. This endpoint is the SOLE creator of user-message history
 * rows (bot-client has no Prisma; ai-worker only updates existing rows).
 *
 * Idempotent against replays (see conversationPersistShared.ts): an
 * at-least-once redelivery of the same event resolves to the same
 * deterministic id, so the handler compares instead of writing and reports
 * `matched` — a `false` there means a replay carried different content
 * (drift between attempts), which is a bug signal. A create that loses a
 * duplicate-delivery race (P2002) falls back to compare; other errors
 * surface.
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
import { logFastPoolTimeout } from '../../utils/dbTimeout.js';
import { fetchExistingConversationRow } from './conversationPersistShared.js';
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
      const existing = await fetchExistingConversationRow(
        prisma,
        id,
        logger,
        'User-message existence check hit a fast-pool DB timeout',
        { channelId }
      );
      if (existing === null) {
        return null;
      }
      // Deliberately lightweight: content + trigger id only. A replay builds
      // messageMetadata from the same bot-side object, so metadata divergence
      // could only come from serialization differences — not worth a deep
      // JSONB comparison for a drift signal.
      const matched =
        existing.content === content && existing.discordMessageId[0] === discordMessageId;
      if (!matched) {
        logger.warn(
          { id, channelId, contentMatch: existing.content === content },
          'User-message persist replay DIVERGED from existing row'
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
      // Only the unique-violation race gets the compare fallback (a duplicate
      // delivery of the same event landed between our existence check and the
      // create); any other failure must surface rather than be masked by a
      // coincidental row.
      const isRace = (error as { code?: string }).code === 'P2002';
      if (!isRace) {
        // Classify before rethrowing so the resulting 5xx carries the
        // {label, sqlstate} diagnostic in the logs instead of a generic error.
        logFastPoolTimeout(
          logger,
          error,
          { durationMs: Date.now() - startedAt, channelId, id },
          'User-message persist hit a fast-pool DB timeout'
        );
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
