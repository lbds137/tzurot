/**
 * POST /admin/personality
 * Create a new AI personality
 */

import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, AVATAR_LIMITS } from '@tzurot/common-types';
import { type PrismaClient, Prisma } from '@prisma/client';
import { requireOwnerAuth } from '../../services/AuthMiddleware.js';
import { optimizeAvatar } from '../../utils/imageProcessor.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { validateSlug, validateCustomFields, validateRequired } from '../../utils/validators.js';

const logger = createLogger('admin-create-personality');

export function createCreatePersonalityRoute(prisma: PrismaClient): Router {
  const router = Router();

  router.post(
    '/',
    requireOwnerAuth(),
    asyncHandler(async (req: Request, res: Response) => {
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
        customFields,
        avatarData,
      } = req.body as {
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
        customFields?: Record<string, unknown> | null;
        avatarData?: string;
      };

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

      // After validation, assert these values are defined
      // This should never fail since validation passed above
      if (
        name === undefined ||
        slug === undefined ||
        characterInfo === undefined ||
        personalityTraits === undefined
      ) {
        throw new Error('Validation passed but required fields are missing');
      }

      // TypeScript now knows these are all strings (not string | undefined)
      const validatedName = name;
      const validatedSlug = slug;
      const validatedCharacterInfo = characterInfo;
      const validatedTraits = personalityTraits;

      // Validate slug format
      const slugFormatValidation = validateSlug(validatedSlug);
      if (!slugFormatValidation.valid) {
        return sendError(res, slugFormatValidation.error);
      }

      // Validate customFields if provided
      const customFieldsValidation = validateCustomFields(customFields);
      if (!customFieldsValidation.valid) {
        return sendError(res, customFieldsValidation.error);
      }

      // Check if personality already exists
      const existing = await prisma.personality.findUnique({
        where: { slug: validatedSlug },
      });

      if (existing !== null) {
        return sendError(
          res,
          ErrorResponses.conflict(`A personality with slug '${validatedSlug}' already exists`)
        );
      }

      // Process avatar if provided
      let processedAvatarData: Buffer | undefined;
      if (avatarData !== undefined && avatarData.length > 0) {
        try {
          logger.info(`[Admin] Processing avatar for personality: ${validatedSlug}`);

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

          processedAvatarData = result.buffer;
        } catch (error) {
          logger.error({ err: error }, '[Admin] Failed to process avatar');
          return sendError(
            res,
            ErrorResponses.processingError(
              'Failed to process avatar image. Ensure it is a valid image file.'
            )
          );
        }
      }

      // Create personality in database
      const personality = await prisma.personality.create({
        data: {
          name: validatedName,
          slug: validatedSlug,
          displayName: displayName ?? null,
          characterInfo: validatedCharacterInfo,
          personalityTraits: validatedTraits,
          personalityTone: personalityTone ?? null,
          personalityAge: personalityAge ?? null,
          personalityAppearance: personalityAppearance ?? null,
          personalityLikes: personalityLikes ?? null,
          personalityDislikes: personalityDislikes ?? null,
          conversationalGoals: conversationalGoals ?? null,
          conversationalExamples: conversationalExamples ?? null,
          ...(customFields !== null && customFields !== undefined
            ? { customFields: customFields as Prisma.InputJsonValue }
            : {}),
          avatarData:
            processedAvatarData !== undefined ? new Uint8Array(processedAvatarData) : null,
          voiceEnabled: false,
          imageEnabled: false,
        },
      });

      logger.info(`[Admin] Created personality: ${validatedSlug} (${personality.id})`);

      // Set default LLM config (find global default config)
      try {
        const defaultLlmConfig = await prisma.llmConfig.findFirst({
          where: {
            isGlobal: true,
            isDefault: true,
          },
        });

        if (defaultLlmConfig !== null) {
          await prisma.personalityDefaultConfig.create({
            data: {
              personalityId: personality.id,
              llmConfigId: defaultLlmConfig.id,
            },
          });
          logger.info(
            `[Admin] Set default LLM config for ${validatedSlug}: ${defaultLlmConfig.name}`
          );
        } else {
          logger.warn(
            {},
            '[Admin] No default global LLM config found, skipping default config assignment'
          );
        }
      } catch (error) {
        // Non-critical error, log but don't fail the request
        logger.error({ err: error }, '[Admin] Failed to set default LLM config');
      }

      sendCustomSuccess(
        res,
        {
          success: true,
          personality: {
            id: personality.id,
            name: personality.name,
            slug: personality.slug,
            displayName: personality.displayName,
            hasAvatar: processedAvatarData !== undefined,
          },
          timestamp: new Date().toISOString(),
        },
        StatusCodes.CREATED
      );
    })
  );

  return router;
}
