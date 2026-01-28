/**
 * POST /admin/personality
 * Create a new AI personality
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  AVATAR_LIMITS,
  assertDefined,
  generatePersonalityUuid,
} from '@tzurot/common-types';
import { type PrismaClient, Prisma } from '@tzurot/common-types';
import { requireOwnerAuth } from '../../services/AuthMiddleware.js';
import { optimizeAvatar } from '../../utils/imageProcessor.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses, type ErrorResponse } from '../../utils/errorResponses.js';
import { validateSlug, validateCustomFields, validateRequired } from '../../utils/validators.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('admin-create-personality');

/** Request body for admin personality creation */
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
  customFields?: Record<string, unknown> | null;
  avatarData?: string;
}

/** Validated required fields from request body */
interface ValidatedFields {
  name: string;
  slug: string;
  characterInfo: string;
  personalityTraits: string;
}

/**
 * Validate required fields for admin personality creation
 */
function validateRequiredFields(
  body: CreatePersonalityBody
): { ok: true; data: ValidatedFields } | { ok: false; error: ErrorResponse } {
  const nameValidation = validateRequired(body.name, 'name');
  if (!nameValidation.valid) {
    return { ok: false, error: nameValidation.error };
  }

  const slugValidation = validateRequired(body.slug, 'slug');
  if (!slugValidation.valid) {
    return { ok: false, error: slugValidation.error };
  }

  const characterInfoValidation = validateRequired(body.characterInfo, 'characterInfo');
  if (!characterInfoValidation.valid) {
    return { ok: false, error: characterInfoValidation.error };
  }

  const traitsValidation = validateRequired(body.personalityTraits, 'personalityTraits');
  if (!traitsValidation.valid) {
    return { ok: false, error: traitsValidation.error };
  }

  // Use assertDefined for type narrowing
  assertDefined(body.name, 'name');
  assertDefined(body.slug, 'slug');
  assertDefined(body.characterInfo, 'characterInfo');
  assertDefined(body.personalityTraits, 'personalityTraits');

  // Validate slug format
  const slugFormatValidation = validateSlug(body.slug);
  if (!slugFormatValidation.valid) {
    return { ok: false, error: slugFormatValidation.error };
  }

  // Validate customFields if provided
  const customFieldsValidation = validateCustomFields(body.customFields);
  if (!customFieldsValidation.valid) {
    return { ok: false, error: customFieldsValidation.error };
  }

  return {
    ok: true,
    data: {
      name: body.name,
      slug: body.slug,
      characterInfo: body.characterInfo,
      personalityTraits: body.personalityTraits,
    },
  };
}

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

export function createCreatePersonalityRoute(prisma: PrismaClient): Router {
  const router = Router();

  router.post(
    '/',
    requireOwnerAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const body = req.body as CreatePersonalityBody;
      const discordUserId = req.userId;

      // Validate required fields
      const validation = validateRequiredFields(body);
      if (!validation.ok) {
        return sendError(res, validation.error);
      }
      const { name, slug, characterInfo, personalityTraits } = validation.data;

      // Get admin user's internal ID for ownership
      const adminUser = await prisma.user.findUnique({
        where: { discordId: discordUserId },
        select: { id: true },
      });

      if (adminUser === null) {
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
      const avatarResult = await processAvatarData(body.avatarData, slug);
      if (!avatarResult.ok) {
        return sendError(res, avatarResult.error);
      }

      // Find default system prompt
      const defaultSystemPrompt = await prisma.systemPrompt.findFirst({
        where: { isDefault: true },
        select: { id: true },
      });

      // Create personality in database
      const personality = await prisma.personality.create({
        data: {
          id: generatePersonalityUuid(slug),
          name,
          slug,
          displayName: body.displayName ?? null,
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
          systemPromptId: defaultSystemPrompt?.id ?? null,
          ownerId: adminUser.id,
          ...(body.customFields !== null && body.customFields !== undefined
            ? { customFields: body.customFields as Prisma.InputJsonValue }
            : {}),
          avatarData:
            avatarResult.buffer !== undefined ? new Uint8Array(avatarResult.buffer) : null,
          voiceEnabled: false,
          imageEnabled: false,
        },
      });

      logger.info(`[Admin] Created personality: ${slug} (${personality.id})`);

      // Set default LLM config (non-blocking)
      await setupDefaultLlmConfig(prisma, personality.id, slug);

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
