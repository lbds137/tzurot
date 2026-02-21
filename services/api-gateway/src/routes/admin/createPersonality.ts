/**
 * POST /admin/personality
 * Create a new AI personality
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  generatePersonalityUuid,
  type CacheInvalidationService,
  PersonalityCreateSchema,
  type PersonalityCreateInput,
} from '@tzurot/common-types';
import { type PrismaClient, Prisma } from '@tzurot/common-types';
import { requireOwnerAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { processAvatarData } from '../../utils/avatarProcessor.js';
import { setupDefaultLlmConfig } from '../../utils/personalityHelpers.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('admin-create-personality');

/**
 * Invalidate cache if personality is public (so other users see it)
 */
async function invalidateCacheIfPublic(
  cacheInvalidationService: CacheInvalidationService | undefined,
  isPublic: boolean | undefined,
  personalityId: string
): Promise<void> {
  if (cacheInvalidationService === undefined || isPublic !== true) {
    return;
  }

  try {
    await cacheInvalidationService.invalidateAll();
    logger.info({ personalityId }, '[Admin] Invalidated personality cache after public create');
  } catch (error) {
    logger.warn({ err: error, personalityId }, '[Admin] Failed to invalidate personality cache');
  }
}

interface PersonalityCreateData {
  validated: PersonalityCreateInput;
  ownerId: string;
  systemPromptId: string | null;
  avatarBuffer: Buffer | undefined;
}

/**
 * Build the personality create data object from validated schema input
 */
function buildPersonalityCreateData(
  data: PersonalityCreateData
): Prisma.PersonalityUncheckedCreateInput {
  const { validated, ownerId, systemPromptId, avatarBuffer } = data;

  return {
    id: generatePersonalityUuid(validated.slug),
    name: validated.name,
    slug: validated.slug,
    displayName: validated.displayName ?? null,
    characterInfo: validated.characterInfo,
    personalityTraits: validated.personalityTraits,
    personalityTone: validated.personalityTone ?? null,
    personalityAge: validated.personalityAge ?? null,
    personalityAppearance: validated.personalityAppearance ?? null,
    personalityLikes: validated.personalityLikes ?? null,
    personalityDislikes: validated.personalityDislikes ?? null,
    conversationalGoals: validated.conversationalGoals ?? null,
    conversationalExamples: validated.conversationalExamples ?? null,
    errorMessage: validated.errorMessage ?? null,
    isPublic: validated.isPublic ?? false,
    systemPromptId,
    ownerId,
    ...(validated.customFields !== null && validated.customFields !== undefined
      ? { customFields: validated.customFields as Prisma.InputJsonValue }
      : {}),
    avatarData: avatarBuffer !== undefined ? new Uint8Array(avatarBuffer) : null,
    voiceEnabled: false,
    imageEnabled: false,
  };
}

export function createCreatePersonalityRoute(
  prisma: PrismaClient,
  cacheInvalidationService?: CacheInvalidationService
): Router {
  const router = Router();

  router.post(
    '/',
    requireOwnerAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;

      // Validate request body with Zod schema
      const parseResult = PersonalityCreateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendZodError(res, parseResult.error);
      }
      const validated = parseResult.data;
      const { slug } = validated;

      // Get admin user's internal ID for ownership
      const adminUser = await prisma.user.findUnique({
        where: { discordId: discordUserId },
        select: { id: true },
      });

      if (adminUser === null) {
        logger.warn({ discordUserId }, 'Admin user not found in database');
        return sendError(res, ErrorResponses.unauthorized('Admin user not found in database'));
      }

      // Check if personality already exists
      const existing = await prisma.personality.findUnique({ where: { slug } });
      if (existing !== null) {
        return sendError(
          res,
          ErrorResponses.conflict(`A personality with slug '${slug}' already exists`)
        );
      }

      // Process avatar if provided
      const avatarResult = await processAvatarData(validated.avatarData, slug);
      if (avatarResult !== null && !avatarResult.ok) {
        return sendError(res, avatarResult.error);
      }

      // Find default system prompt
      const defaultSystemPrompt = await prisma.systemPrompt.findFirst({
        where: { isDefault: true },
        select: { id: true },
      });

      // Create personality in database
      const createData = buildPersonalityCreateData({
        validated,
        ownerId: adminUser.id,
        systemPromptId: defaultSystemPrompt?.id ?? null,
        avatarBuffer: avatarResult?.ok === true ? avatarResult.buffer : undefined,
      });
      const personality = await prisma.personality.create({ data: createData });

      logger.info(`[Admin] Created personality: ${slug} (${personality.id})`);

      // Post-creation tasks
      await setupDefaultLlmConfig(prisma, personality.id, slug);
      await invalidateCacheIfPublic(cacheInvalidationService, validated.isPublic, personality.id);

      sendCustomSuccess(
        res,
        {
          success: true,
          personality: {
            id: personality.id,
            name: personality.name,
            slug: personality.slug,
            displayName: personality.displayName,
            hasAvatar: avatarResult?.ok === true,
          },
          timestamp: new Date().toISOString(),
        },
        StatusCodes.CREATED
      );
    })
  );

  return router;
}
