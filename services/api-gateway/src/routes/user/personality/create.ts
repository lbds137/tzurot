/**
 * POST /user/personality
 * Create a new personality owned by the user
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  AVATAR_LIMITS,
  generatePersonalityUuid,
  PersonalityCreateSchema,
  type PersonalityCreateInput,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses, type ErrorResponse } from '../../../utils/errorResponses.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import { validateSlug } from '../../../utils/validators.js';
import { optimizeAvatar } from '../../../utils/imageProcessor.js';
import type { AuthenticatedRequest } from '../../../types.js';
import { getOrCreateInternalUser } from './helpers.js';

const logger = createLogger('user-personality-create');

/**
 * Process avatar data if provided
 * Returns processed buffer, null for no avatar, or error response
 */
async function processAvatarData(
  avatarData: string | undefined,
  slug: string
): Promise<{ ok: true; buffer: Buffer | undefined } | { ok: false; error: ErrorResponse }> {
  if (avatarData === undefined || avatarData.length === 0) {
    return { ok: true, buffer: undefined };
  }

  try {
    logger.info(`[User] Processing avatar for personality: ${slug}`);
    const result = await optimizeAvatar(avatarData);
    logger.info(
      `[User] Avatar optimized: ${result.originalSizeKB} KB → ${result.processedSizeKB} KB (quality: ${result.quality})`
    );
    if (result.exceedsTarget) {
      logger.warn(
        {},
        `[User] Avatar still exceeds ${AVATAR_LIMITS.TARGET_SIZE_KB}KB after optimization: ${result.processedSizeKB} KB`
      );
    }
    return { ok: true, buffer: result.buffer };
  } catch (error) {
    logger.error({ err: error }, '[User] Failed to process avatar');
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
 * Logs errors but doesn't fail the creation
 */
async function setupDefaultLlmConfig(prisma: PrismaClient, personalityId: string): Promise<void> {
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
    }
  } catch (error) {
    logger.error({ err: error }, '[User] Failed to set default LLM config');
  }
}

/**
 * Create handler for POST /user/personality
 * Create a new personality owned by the user
 */
export function createCreateHandler(prisma: PrismaClient): RequestHandler[] {
  const handler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    // Validate request body with Zod schema
    const parseResult = PersonalityCreateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const body: PersonalityCreateInput = parseResult.data;
    const { name, slug, characterInfo, personalityTraits } = body;

    // Validate business rules that Zod doesn't cover (reserved slugs, consecutive hyphens, trailing hyphens)
    const slugValidation = validateSlug(slug);
    if (!slugValidation.valid) {
      return sendError(res, slugValidation.error);
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
    const avatarResult = await processAvatarData(body.avatarData, slug);
    if (!avatarResult.ok) {
      return sendError(res, avatarResult.error);
    }

    // Get or create user and find default system prompt in parallel
    const [user, defaultSystemPrompt] = await Promise.all([
      getOrCreateInternalUser(prisma, discordUserId),
      prisma.systemPrompt.findFirst({ where: { isDefault: true }, select: { id: true } }),
    ]);

    // Create personality in database
    const hasDisplayName =
      body.displayName !== null && body.displayName !== undefined && body.displayName !== '';
    const personality = await prisma.personality.create({
      data: {
        id: generatePersonalityUuid(slug),
        name,
        slug,
        displayName: hasDisplayName ? body.displayName : name,
        characterInfo,
        personalityTraits,
        personalityTone: body.personalityTone ?? null,
        personalityAge: body.personalityAge ?? null,
        personalityAppearance: body.personalityAppearance ?? null,
        personalityLikes: body.personalityLikes ?? null,
        personalityDislikes: body.personalityDislikes ?? null,
        conversationalGoals: body.conversationalGoals ?? null,
        conversationalExamples: body.conversationalExamples ?? null,
        errorMessage: body.errorMessage ?? null,
        isPublic: body.isPublic ?? false,
        ownerId: user.id,
        systemPromptId: defaultSystemPrompt?.id ?? null,
        avatarData: avatarResult.buffer !== undefined ? new Uint8Array(avatarResult.buffer) : null,
        voiceEnabled: false,
        imageEnabled: false,
      },
    });

    logger.info(
      { discordUserId, slug, personalityId: personality.id },
      '[User] Created personality'
    );

    // Set default LLM config (non-blocking, errors logged but don't fail creation)
    await setupDefaultLlmConfig(prisma, personality.id);

    // Return full personality data for dashboard display
    sendCustomSuccess(
      res,
      {
        success: true,
        personality: {
          id: personality.id,
          name: personality.name,
          slug: personality.slug,
          displayName: personality.displayName,
          characterInfo: personality.characterInfo,
          personalityTraits: personality.personalityTraits,
          personalityTone: personality.personalityTone,
          personalityAge: personality.personalityAge,
          personalityAppearance: personality.personalityAppearance,
          personalityLikes: personality.personalityLikes,
          personalityDislikes: personality.personalityDislikes,
          conversationalGoals: personality.conversationalGoals,
          conversationalExamples: personality.conversationalExamples,
          errorMessage: personality.errorMessage,
          birthMonth: null, // Not yet supported in create
          birthDay: null,
          birthYear: null,
          isPublic: personality.isPublic,
          voiceEnabled: personality.voiceEnabled,
          imageEnabled: personality.imageEnabled,
          ownerId: discordUserId, // Return Discord ID for bot-client
          hasAvatar: avatarResult.buffer !== undefined,
          createdAt: personality.createdAt.toISOString(),
          updatedAt: personality.updatedAt.toISOString(),
        },
      },
      StatusCodes.CREATED
    );
  });

  return [requireUserAuth(), handler];
}
