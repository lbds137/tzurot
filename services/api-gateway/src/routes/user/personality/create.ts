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
  assertDefined,
  generatePersonalityUuid,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { validateSlug, validateRequired } from '../../../utils/validators.js';
import { optimizeAvatar } from '../../../utils/imageProcessor.js';
import type { AuthenticatedRequest } from '../../../types.js';
import { getOrCreateInternalUser } from './helpers.js';

const logger = createLogger('user-personality-create');

interface CreatePersonalityBody {
  name?: string;
  slug?: string;
  characterInfo?: string;
  personalityTraits?: string;
  displayName?: string | null;
  personalityTone?: string | null;
  personalityAge?: string | null;
  personalityAppearance?: string | null;
  personalityLikes?: string | null;
  personalityDislikes?: string | null;
  conversationalGoals?: string | null;
  conversationalExamples?: string | null;
  errorMessage?: string | null;
  isPublic?: boolean;
  avatarData?: string;
}

/**
 * Create handler for POST /user/personality
 * Create a new personality owned by the user
 */
export function createCreateHandler(prisma: PrismaClient): RequestHandler[] {
  const handler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    const {
      name,
      slug,
      characterInfo,
      personalityTraits,
      displayName,
      personalityTone,
      personalityAge,
      personalityAppearance,
      personalityLikes,
      personalityDislikes,
      conversationalGoals,
      conversationalExamples,
      errorMessage,
      isPublic,
      avatarData,
    } = req.body as CreatePersonalityBody;

    // Validate required fields
    const nameValidation = validateRequired(name, 'name');
    if (!nameValidation.valid) {
      return sendError(res, nameValidation.error);
    }

    const slugValidation = validateRequired(slug, 'slug');
    if (!slugValidation.valid) {
      return sendError(res, slugValidation.error);
    }

    const characterInfoValidation = validateRequired(characterInfo, 'characterInfo');
    if (!characterInfoValidation.valid) {
      return sendError(res, characterInfoValidation.error);
    }

    const traitsValidation = validateRequired(personalityTraits, 'personalityTraits');
    if (!traitsValidation.valid) {
      return sendError(res, traitsValidation.error);
    }

    assertDefined(name, 'name');
    assertDefined(slug, 'slug');
    assertDefined(characterInfo, 'characterInfo');
    assertDefined(personalityTraits, 'personalityTraits');

    // Validate slug format
    const slugFormatValidation = validateSlug(slug);
    if (!slugFormatValidation.valid) {
      return sendError(res, slugFormatValidation.error);
    }

    // Check if personality already exists
    const existing = await prisma.personality.findUnique({
      where: { slug },
    });

    if (existing !== null) {
      return sendError(
        res,
        ErrorResponses.conflict(`A personality with slug '${slug}' already exists`)
      );
    }

    // Get or create user
    const user = await getOrCreateInternalUser(prisma, discordUserId);

    // Find default system prompt to link to the new personality
    const defaultSystemPrompt = await prisma.systemPrompt.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });

    // Process avatar if provided
    let processedAvatarData: Buffer | undefined;
    if (avatarData !== undefined && avatarData.length > 0) {
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
        processedAvatarData = result.buffer;
      } catch (error) {
        logger.error({ err: error }, '[User] Failed to process avatar');
        return sendError(
          res,
          ErrorResponses.processingError(
            'Failed to process avatar image. Ensure it is a valid image file.'
          )
        );
      }
    }

    // Create personality in database
    // If displayName not provided or empty, default to name
    const hasDisplayName = displayName !== null && displayName !== undefined && displayName !== '';
    const personality = await prisma.personality.create({
      data: {
        id: generatePersonalityUuid(slug),
        name,
        slug,
        displayName: hasDisplayName ? displayName : name,
        characterInfo,
        personalityTraits,
        personalityTone: personalityTone ?? null,
        personalityAge: personalityAge ?? null,
        personalityAppearance: personalityAppearance ?? null,
        personalityLikes: personalityLikes ?? null,
        personalityDislikes: personalityDislikes ?? null,
        conversationalGoals: conversationalGoals ?? null,
        conversationalExamples: conversationalExamples ?? null,
        errorMessage: errorMessage ?? null,
        isPublic: isPublic ?? false,
        ownerId: user.id,
        systemPromptId: defaultSystemPrompt?.id ?? null,
        avatarData: processedAvatarData !== undefined ? new Uint8Array(processedAvatarData) : null,
        voiceEnabled: false,
        imageEnabled: false,
      },
    });

    logger.info(
      { discordUserId, slug, personalityId: personality.id },
      '[User] Created personality'
    );

    // Set default LLM config
    try {
      const defaultLlmConfig = await prisma.llmConfig.findFirst({
        where: { isGlobal: true, isDefault: true },
      });

      if (defaultLlmConfig !== null) {
        await prisma.personalityDefaultConfig.create({
          data: {
            personalityId: personality.id,
            llmConfigId: defaultLlmConfig.id,
          },
        });
      }
    } catch (error) {
      logger.error({ err: error }, '[User] Failed to set default LLM config');
    }

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
          hasAvatar: processedAvatarData !== undefined,
          createdAt: personality.createdAt.toISOString(),
          updatedAt: personality.updatedAt.toISOString(),
        },
      },
      StatusCodes.CREATED
    );
  });

  return [requireUserAuth(), handler];
}
