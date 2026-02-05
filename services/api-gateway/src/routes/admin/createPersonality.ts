/**
 * POST /admin/personality
 * Create a new AI personality
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  AVATAR_LIMITS,
  generatePersonalityUuid,
  type CacheInvalidationService,
  PersonalityCreateSchema,
  type PersonalityCreateInput,
} from '@tzurot/common-types';
import { type PrismaClient, Prisma } from '@tzurot/common-types';
import { requireOwnerAuth } from '../../services/AuthMiddleware.js';
import { optimizeAvatar } from '../../utils/imageProcessor.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses, type ErrorResponse } from '../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('admin-create-personality');

/**
 * Process avatar data if provided
 */
async function processAvatarData(
  avatarData: string | undefined,
  slug: string
): Promise<{ ok: true; buffer: Buffer | undefined } | { ok: false; error: ErrorResponse }> {
  if (avatarData === undefined || avatarData.length === 0) {
    return { ok: true, buffer: undefined };
  }

  try {
    logger.info(`[Admin] Processing avatar for personality: ${slug}`);
    const result = await optimizeAvatar(avatarData);
    logger.info(
      `[Admin] Avatar optimized: ${result.originalSizeKB} KB → ${result.processedSizeKB} KB (quality: ${result.quality})`
    );
    if (result.exceedsTarget) {
      logger.warn(
        {},
        `[Admin] Avatar still exceeds ${AVATAR_LIMITS.TARGET_SIZE_KB}KB after optimization: ${result.processedSizeKB} KB`
      );
    }
    return { ok: true, buffer: result.buffer };
  } catch (error) {
    logger.error({ err: error }, '[Admin] Failed to process avatar');
    return {
      ok: false,
      error: ErrorResponses.processingError(
        'Failed to process avatar image. Ensure it is a valid image file.'
      ),
    };
  }
}

/**
 * Set up default LLM config for newly created personality
 */
async function setupDefaultLlmConfig(
  prisma: PrismaClient,
  personalityId: string,
  slug: string
): Promise<void> {
  try {
    const defaultLlmConfig = await prisma.llmConfig.findFirst({
      where: { isGlobal: true, isDefault: true },
    });

    if (defaultLlmConfig !== null) {
      await prisma.personalityDefaultConfig.create({
        data: {
          personalityId,
          llmConfigId: defaultLlmConfig.id,
        },
      });
      logger.info(`[Admin] Set default LLM config for ${slug}: ${defaultLlmConfig.name}`);
    } else {
      logger.warn(
        {},
        '[Admin] No default global LLM config found, skipping default config assignment'
      );
    }
  } catch (error) {
    logger.error({ err: error }, '[Admin] Failed to set default LLM config');
  }
}

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
        const firstIssue = parseResult.error.issues[0];
        return sendError(
          res,
          ErrorResponses.validationError(`${firstIssue.path.join('.')}: ${firstIssue.message}`)
        );
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
      if (!avatarResult.ok) {
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
        avatarBuffer: avatarResult.buffer,
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
            hasAvatar: avatarResult.buffer !== undefined,
          },
          timestamp: new Date().toISOString(),
        },
        StatusCodes.CREATED
      );
    })
  );

  return router;
}
