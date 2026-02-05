/**
 * PATCH /admin/personality/:slug
 * Edit an existing AI personality
 */

import { Router, type Request, type Response } from 'express';
import { createLogger, AVATAR_LIMITS, type CacheInvalidationService } from '@tzurot/common-types';
import { type PrismaClient, Prisma } from '@tzurot/common-types';
import { requireOwnerAuth } from '../../services/AuthMiddleware.js';
import { optimizeAvatar } from '../../utils/imageProcessor.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { validateSlug, validateCustomFields } from '../../utils/validators.js';
import { getParam } from '../../utils/requestParams.js';

const logger = createLogger('admin-update-personality');

interface UpdatePersonalityBody {
  name?: string;
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
  /** Whether this personality should be publicly visible */
  isPublic?: boolean;
}

// --- Helper Functions ---

async function processAvatarIfProvided(
  avatarData: string | undefined,
  slug: string
): Promise<
  { buffer: Buffer } | { error: ReturnType<typeof ErrorResponses.processingError> } | null
> {
  if (avatarData === undefined || avatarData.length === 0) {
    return null;
  }

  try {
    logger.info(`[Admin] Processing avatar update for personality: ${slug}`);
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

    return { buffer: result.buffer };
  } catch (error) {
    logger.error({ err: error }, '[Admin] Failed to process avatar');
    return {
      error: ErrorResponses.processingError(
        'Failed to process avatar image. Ensure it is a valid image file.'
      ),
    };
  }
}

function buildUpdateData(
  body: UpdatePersonalityBody,
  processedAvatarData?: Buffer
): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};
  const fields: (keyof Omit<UpdatePersonalityBody, 'avatarData' | 'customFields'>)[] = [
    'name',
    'characterInfo',
    'personalityTraits',
    'displayName',
    'personalityTone',
    'personalityAge',
    'personalityAppearance',
    'personalityLikes',
    'personalityDislikes',
    'conversationalGoals',
    'conversationalExamples',
    'errorMessage',
    'isPublic',
  ];

  for (const field of fields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  if (body.customFields !== undefined) {
    updateData.customFields = body.customFields as Prisma.InputJsonValue;
  }
  if (processedAvatarData !== undefined) {
    updateData.avatarData = new Uint8Array(processedAvatarData);
  }

  return updateData;
}

// --- Route Handler ---

export function createUpdatePersonalityRoute(
  prisma: PrismaClient,
  cacheInvalidationService?: CacheInvalidationService
): Router {
  const router = Router();

  router.patch(
    '/:slug',
    requireOwnerAuth(),
    asyncHandler(async (req: Request, res: Response) => {
      const slug = getParam(req.params.slug);
      if (slug === undefined) {
        return sendError(res, ErrorResponses.validationError('slug is required'));
      }

      const body = req.body as UpdatePersonalityBody;

      // Validate slug format
      const slugValidation = validateSlug(slug);
      if (!slugValidation.valid) {
        return sendError(res, slugValidation.error);
      }

      // Check if personality exists
      const existing = await prisma.personality.findUnique({ where: { slug } });
      if (existing === null) {
        return sendError(res, ErrorResponses.notFound(`Personality with slug '${slug}'`));
      }

      // Validate customFields if provided
      const customFieldsValidation = validateCustomFields(body.customFields);
      if (!customFieldsValidation.valid) {
        return sendError(res, customFieldsValidation.error);
      }

      // Process avatar if provided
      const avatarResult = await processAvatarIfProvided(body.avatarData, slug);
      if (avatarResult !== null && 'error' in avatarResult) {
        return sendError(res, avatarResult.error);
      }

      // Build and execute update
      const updateData = buildUpdateData(body, avatarResult?.buffer);
      const personality = await prisma.personality.update({
        where: { slug },
        data: updateData,
      });

      logger.info(`[Admin] Updated personality: ${slug} (${personality.id})`);

      // Invalidate cache after update
      if (cacheInvalidationService !== undefined) {
        try {
          await cacheInvalidationService.invalidatePersonality(personality.id);
          logger.info(
            { personalityId: personality.id },
            '[Admin] Invalidated personality cache after update'
          );
        } catch (error) {
          logger.warn(
            { err: error, personalityId: personality.id },
            '[Admin] Failed to invalidate personality cache'
          );
        }
      }

      sendCustomSuccess(res, {
        success: true,
        personality: {
          id: personality.id,
          name: personality.name,
          slug: personality.slug,
          displayName: personality.displayName,
          hasAvatar: personality.avatarData !== null,
        },
        timestamp: new Date().toISOString(),
      });
    })
  );

  return router;
}
