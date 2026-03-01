/**
 * LLM Config Resolve Handler
 *
 * POST /user/llm-config/resolve
 * Resolves the effective LLM config for a user+personality combination.
 * Used by bot-client to get context settings (maxMessages, maxAge, maxImages)
 * before building conversation context.
 */

import { type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import {
  createLogger,
  LlmConfigResolver,
  ConfigCascadeResolver,
  DISCORD_SNOWFLAKE,
  type PrismaClient,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('user-llm-config-resolve');

/**
 * Request body for resolving config
 * Bot-client sends this to get resolved config before context building
 */
interface ResolveConfigBody {
  personalityId: string;
  personalityConfig: LoadedPersonality;
  channelId?: string;
}

/** @internal Exported for testing only */
export const resolveConfigBodySchema = z.object({
  personalityId: z.string().min(1),
  personalityConfig: z
    .object({
      id: z.string(),
      name: z.string(),
      model: z.string(),
    })
    .passthrough(), // Allow additional LoadedPersonality fields
  channelId: z.string().regex(DISCORD_SNOWFLAKE.PATTERN, 'Invalid channelId format').optional(),
});

export function createResolveHandler(prisma: PrismaClient) {
  // Create resolvers with cleanup disabled (short-lived request handler)
  const resolver = new LlmConfigResolver(prisma, { enableCleanup: false });
  const cascadeResolver = new ConfigCascadeResolver(prisma, { enableCleanup: false });

  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    const parseResult = resolveConfigBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendError(res, ErrorResponses.validationError(parseResult.error.message));
    }

    const { personalityId, personalityConfig, channelId } = parseResult.data as ResolveConfigBody;

    try {
      const [result, overrides] = await Promise.all([
        resolver.resolveConfig(discordUserId, personalityId, personalityConfig),
        cascadeResolver.resolveOverrides(discordUserId, personalityId, channelId),
      ]);

      logger.debug(
        { discordUserId, personalityId, source: result.source },
        '[LlmConfig] Config resolved'
      );

      sendCustomSuccess(res, { ...result, overrides }, StatusCodes.OK);
    } catch (error) {
      logger.error(
        { err: error, discordUserId, personalityId },
        '[LlmConfig] Failed to resolve config'
      );
      return sendError(res, ErrorResponses.internalError('Failed to resolve config'));
    }
  };
}
