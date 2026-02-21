/**
 * PATCH /admin/personality/:slug
 * Edit an existing AI personality
 */

import { Router, type Request, type Response } from 'express';
import {
  createLogger,
  type CacheInvalidationService,
  PersonalityUpdateSchema,
  type PersonalityUpdateInput,
} from '@tzurot/common-types';
import { type PrismaClient, Prisma } from '@tzurot/common-types';
import { requireOwnerAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { getParam } from '../../utils/requestParams.js';
import { validateSlug } from '../../utils/validators.js';
import { processAvatarData } from '../../utils/avatarProcessor.js';

const logger = createLogger('admin-update-personality');

// --- Helper Functions ---

function buildUpdateData(
  validated: PersonalityUpdateInput,
  processedAvatarData?: Buffer
): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};
  const fields: (keyof Omit<PersonalityUpdateInput, 'avatarData' | 'customFields'>)[] = [
    'name',
    'slug',
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
    if (validated[field] !== undefined) {
      updateData[field] = validated[field];
    }
  }

  if (validated.customFields !== undefined) {
    updateData.customFields = validated.customFields as Prisma.InputJsonValue;
  }
  if (processedAvatarData !== undefined) {
    updateData.avatarData = new Uint8Array(processedAvatarData);
  }

  return updateData;
}

/**
 * Invalidate cache after personality update.
 * - If visibility changed (or is now public), invalidate all caches
 * - Otherwise, just invalidate this specific personality
 */
async function invalidateCacheAfterUpdate(
  cacheInvalidationService: CacheInvalidationService | undefined,
  personalityId: string,
  wasPublic: boolean,
  isNowPublic: boolean
): Promise<void> {
  if (cacheInvalidationService === undefined) {
    return;
  }

  try {
    // If visibility changed or personality is public, invalidate all caches
    // so other users see the change (or stop seeing it)
    if (wasPublic !== isNowPublic || isNowPublic) {
      await cacheInvalidationService.invalidateAll();
      logger.info(
        { personalityId, wasPublic, isNowPublic },
        '[Admin] Invalidated all personality caches after visibility-affecting update'
      );
    } else {
      // Private personality, visibility unchanged - just invalidate this one
      await cacheInvalidationService.invalidatePersonality(personalityId);
      logger.info({ personalityId }, '[Admin] Invalidated personality cache after private update');
    }
  } catch (error) {
    logger.warn({ err: error, personalityId }, '[Admin] Failed to invalidate personality cache');
  }
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

      // Validate URL param slug format and reserved names
      const slugValidation = validateSlug(slug);
      if (!slugValidation.valid) {
        return sendError(res, slugValidation.error);
      }

      // Validate request body with Zod schema
      const parseResult = PersonalityUpdateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendZodError(res, parseResult.error);
      }
      const validated = parseResult.data;

      // Check if personality exists and get current visibility state
      const existing = await prisma.personality.findUnique({
        where: { slug },
        select: { id: true, isPublic: true },
      });
      if (existing === null) {
        return sendError(res, ErrorResponses.notFound(`Personality with slug '${slug}'`));
      }

      // Check slug uniqueness if being changed
      if (validated.slug !== undefined && validated.slug !== slug) {
        const conflicting = await prisma.personality.findUnique({
          where: { slug: validated.slug },
          select: { id: true },
        });
        if (conflicting !== null) {
          return sendError(
            res,
            ErrorResponses.conflict(`A personality with slug '${validated.slug}' already exists`)
          );
        }
      }

      // Process avatar if provided
      const avatarResult = await processAvatarData(validated.avatarData, slug);
      if (avatarResult !== null && !avatarResult.ok) {
        return sendError(res, avatarResult.error);
      }

      // Build and execute update
      const updateData = buildUpdateData(
        validated,
        avatarResult?.ok === true ? avatarResult.buffer : undefined
      );
      const personality = await prisma.personality.update({
        where: { slug },
        data: updateData,
      });

      logger.info(`[Admin] Updated personality: ${slug} (${personality.id})`);

      // Invalidate cache with visibility-aware logic
      const wasPublic = existing.isPublic;
      const isNowPublic = validated.isPublic ?? wasPublic;
      await invalidateCacheAfterUpdate(
        cacheInvalidationService,
        personality.id,
        wasPublic,
        isNowPublic
      );

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
