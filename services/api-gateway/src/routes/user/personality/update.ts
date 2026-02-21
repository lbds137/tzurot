/**
 * PUT /user/personality/:slug
 * Update an owned personality
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  isBotOwner,
  type PrismaClient,
  type CacheInvalidationService,
  PersonalityUpdateSchema,
  type PersonalityUpdateInput,
  PERSONALITY_DETAIL_SELECT,
} from '@tzurot/common-types';
import { Prisma } from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import { validateSlug } from '../../../utils/validators.js';
import { processAvatarData } from '../../../utils/avatarProcessor.js';
import { deleteAllAvatarVersions } from '../../../utils/avatarPaths.js';
import type { AuthenticatedRequest } from '../../../types.js';
import { getParam } from '../../../utils/requestParams.js';
import { findInternalUser, canUserEditPersonality } from './helpers.js';
import { formatPersonalityResponse } from './formatters.js';

const logger = createLogger('user-personality-update');

// --- Helper Functions ---

function buildUpdateData(
  body: PersonalityUpdateInput,
  existingName: string
): Prisma.PersonalityUpdateInput {
  const updateData: Prisma.PersonalityUpdateInput = {};

  const simpleFields: (keyof PersonalityUpdateInput)[] = [
    'slug',
    'characterInfo',
    'personalityTraits',
    'personalityTone',
    'personalityAge',
    'personalityAppearance',
    'personalityLikes',
    'personalityDislikes',
    'conversationalGoals',
    'conversationalExamples',
    'errorMessage',
  ];

  for (const field of simpleFields) {
    if (body[field] !== undefined) {
      (updateData as Record<string, unknown>)[field] = body[field];
    }
  }

  if (body.name !== undefined) {
    updateData.name = body.name;
    if (body.displayName === undefined) {
      updateData.displayName = body.name;
    }
  }

  if (body.displayName !== undefined) {
    const hasDisplayName = body.displayName !== null && body.displayName !== '';
    updateData.displayName = hasDisplayName ? body.displayName : (body.name ?? existingName);
  }

  return updateData;
}

async function handleAvatarCacheInvalidation(
  slug: string,
  personalityId: string,
  cacheInvalidationService?: CacheInvalidationService
): Promise<void> {
  await deleteAllAvatarVersions(slug, 'User avatar update');

  if (cacheInvalidationService) {
    try {
      await cacheInvalidationService.invalidatePersonality(personalityId);
      logger.info({ personalityId }, '[User] Invalidated personality cache after avatar update');
    } catch (error) {
      logger.warn({ err: error, personalityId }, '[User] Failed to invalidate personality cache');
    }
  }
}

async function handleSlugCacheInvalidation(
  oldSlug: string,
  newSlug: string,
  personalityId: string,
  cacheInvalidationService?: CacheInvalidationService
): Promise<void> {
  // Delete cached avatars for both old and new slugs (all versions)
  await deleteAllAvatarVersions(oldSlug, 'Slug update - old slug');
  await deleteAllAvatarVersions(newSlug, 'Slug update - new slug');

  // Invalidate personality cache
  if (cacheInvalidationService) {
    try {
      await cacheInvalidationService.invalidatePersonality(personalityId);
      logger.info({ personalityId }, '[User] Invalidated personality cache after slug update');
    } catch (error) {
      logger.warn({ err: error, personalityId }, '[User] Failed to invalidate personality cache');
    }
  }
}

// --- Handler Factory ---

function createHandler(prisma: PrismaClient, cacheInvalidationService?: CacheInvalidationService) {
  // eslint-disable-next-line sonarjs/cognitive-complexity -- Personality update handler with ~15 optional fields, ownership verification, slug uniqueness check, and cache invalidation
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const slug = getParam(req.params.slug);
    if (slug === undefined || slug === '') {
      return sendError(res, ErrorResponses.validationError('slug is required'));
    }

    const user = await findInternalUser(prisma, discordUserId);
    if (user === null) {
      return sendError(res, ErrorResponses.unauthorized('User not found'));
    }

    const personality = await prisma.personality.findUnique({
      where: { slug },
      select: { id: true, ownerId: true, name: true },
    });

    if (personality === null) {
      return sendError(res, ErrorResponses.notFound('Personality not found'));
    }

    const canEdit = await canUserEditPersonality(prisma, user.id, personality.id, discordUserId);
    if (!canEdit) {
      return sendError(
        res,
        ErrorResponses.unauthorized('You do not have permission to edit this personality')
      );
    }

    // Validate request body with Zod schema
    const parseResult = PersonalityUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const body = parseResult.data;

    // Field-level permission check: slug updates require bot owner
    if (body.slug !== undefined && body.slug !== slug) {
      if (!isBotOwner(discordUserId)) {
        logger.warn(
          { discordUserId, currentSlug: slug, attemptedSlug: body.slug },
          '[User] Non-admin attempted slug update'
        );
        return sendError(
          res,
          ErrorResponses.unauthorized('Only bot admins can update personality slugs')
        );
      }

      // Validate slug format
      const slugValidation = validateSlug(body.slug);
      if (!slugValidation.valid) {
        return sendError(res, slugValidation.error);
      }

      // Check uniqueness - ensure new slug doesn't already exist
      const existingWithSlug = await prisma.personality.findUnique({
        where: { slug: body.slug },
        select: { id: true },
      });
      if (existingWithSlug !== null) {
        return sendError(
          res,
          ErrorResponses.validationError(`Slug "${body.slug}" is already in use`)
        );
      }

      logger.info(
        { discordUserId, oldSlug: slug, newSlug: body.slug, personalityId: personality.id },
        '[User] Bot admin updating personality slug'
      );
    }

    // Track if slug is actually changing (for cache invalidation)
    const slugWasUpdated = body.slug !== undefined && body.slug !== slug;

    const updateData = buildUpdateData(body, personality.name);

    const avatarResult = await processAvatarData(body.avatarData, slug);
    if (avatarResult !== null && !avatarResult.ok) {
      return sendError(res, avatarResult.error);
    }

    const avatarUpdated = avatarResult?.ok === true;
    if (avatarUpdated) {
      updateData.avatarData = new Uint8Array(avatarResult.buffer);
    }

    const updated = await prisma.personality.update({
      where: { id: personality.id },
      data: updateData,
      select: PERSONALITY_DETAIL_SELECT,
    });

    if (avatarUpdated) {
      await handleAvatarCacheInvalidation(slug, personality.id, cacheInvalidationService);
    }

    // Invalidate caches when slug changes (avatar files may be cached by slug)
    if (slugWasUpdated && body.slug !== undefined) {
      await handleSlugCacheInvalidation(slug, body.slug, personality.id, cacheInvalidationService);
    }

    logger.info(
      {
        discordUserId,
        slug,
        personalityId: personality.id,
        avatarUpdated,
        slugUpdated: slugWasUpdated,
      },
      '[User] Updated personality'
    );

    sendCustomSuccess(
      res,
      { success: true, personality: formatPersonalityResponse(updated) },
      StatusCodes.OK
    );
  };
}

// --- Route Factory ---

export function createUpdateHandler(
  prisma: PrismaClient,
  cacheInvalidationService?: CacheInvalidationService
): RequestHandler[] {
  return [requireUserAuth(), asyncHandler(createHandler(prisma, cacheInvalidationService))];
}
