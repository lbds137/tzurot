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
import { requireUserAuth, requireProvisionedUser } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses, type ErrorResponse } from '../../../utils/errorResponses.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import { validateSlug } from '../../../utils/validators.js';
import { processAvatarData } from '../../../utils/avatarProcessor.js';
import { processVoiceReferenceData } from '../../../utils/voiceReferenceProcessor.js';
import { deleteAllAvatarVersions } from '../../../utils/avatarPaths.js';
import type { AuthenticatedRequest } from '../../../types.js';
import { getParam } from '../../../utils/requestParams.js';
import { resolvePersonalityForEdit } from './helpers.js';
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
    'voiceEnabled',
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

async function invalidatePersonalityCache(
  personalityId: string,
  reason: string,
  cacheInvalidationService?: CacheInvalidationService
): Promise<void> {
  if (cacheInvalidationService) {
    try {
      await cacheInvalidationService.invalidatePersonality(personalityId);
      logger.info({ personalityId, reason }, 'Invalidated personality cache');
    } catch (error) {
      logger.warn({ err: error, personalityId, reason }, 'Failed to invalidate personality cache');
    }
  }
}

async function handleAvatarCacheInvalidation(
  slug: string,
  personalityId: string,
  cacheInvalidationService?: CacheInvalidationService
): Promise<void> {
  await deleteAllAvatarVersions(slug, 'User avatar update');
  await invalidatePersonalityCache(personalityId, 'avatar update', cacheInvalidationService);
}

async function handleSlugCacheInvalidation(
  oldSlug: string,
  newSlug: string,
  personalityId: string,
  cacheInvalidationService?: CacheInvalidationService
): Promise<void> {
  await deleteAllAvatarVersions(oldSlug, 'Slug update - old slug');
  await deleteAllAvatarVersions(newSlug, 'Slug update - new slug');
  await invalidatePersonalityCache(personalityId, 'slug update', cacheInvalidationService);
}

/** Process media uploads (avatar + voice reference), returning fields to merge */
async function processMediaUploads(
  body: PersonalityUpdateInput,
  slug: string
): Promise<{
  avatarUpdated: boolean;
  mediaFields: Prisma.PersonalityUpdateInput;
  error?: ErrorResponse;
}> {
  const mediaFields: Prisma.PersonalityUpdateInput = {};

  const avatarResult = await processAvatarData(body.avatarData, slug);
  if (avatarResult !== null && !avatarResult.ok) {
    return { avatarUpdated: false, mediaFields, error: avatarResult.error };
  }

  const avatarUpdated = avatarResult?.ok === true;
  if (avatarUpdated) {
    mediaFields.avatarData = new Uint8Array(avatarResult.buffer);
  }

  // null = clear existing voice reference, undefined = don't change, string = set new
  if (body.voiceReferenceData === null) {
    mediaFields.voiceReferenceData = null;
    mediaFields.voiceReferenceType = null;
  } else {
    const voiceRefResult = processVoiceReferenceData(body.voiceReferenceData, slug);
    if (voiceRefResult !== null && !voiceRefResult.ok) {
      return { avatarUpdated, mediaFields, error: voiceRefResult.error };
    }

    if (voiceRefResult?.ok === true) {
      mediaFields.voiceReferenceData = new Uint8Array(voiceRefResult.buffer);
      mediaFields.voiceReferenceType = voiceRefResult.mimeType;
    }
  }

  return { avatarUpdated, mediaFields };
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

    const resolved = await resolvePersonalityForEdit<{ id: string; ownerId: string; name: string }>(
      prisma,
      slug,
      discordUserId,
      res,
      { select: { id: true, ownerId: true, name: true } }
    );
    if (resolved === null) {
      return;
    }
    const { personality } = resolved;

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
          'Non-admin attempted slug update'
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
        'Bot admin updating personality slug'
      );
    }

    // Track if slug is actually changing (for cache invalidation)
    const slugWasUpdated = body.slug !== undefined && body.slug !== slug;

    const updateData = buildUpdateData(body, personality.name);

    const mediaResult = await processMediaUploads(body, slug);
    if (mediaResult.error !== undefined) {
      return sendError(res, mediaResult.error);
    }
    const { avatarUpdated, mediaFields } = mediaResult;

    const updated = await prisma.personality.update({
      where: { id: personality.id },
      data: { ...updateData, ...mediaFields },
      select: PERSONALITY_DETAIL_SELECT,
    });

    if (avatarUpdated) {
      await handleAvatarCacheInvalidation(slug, personality.id, cacheInvalidationService);
    }

    // Invalidate personality cache when voice settings change (voiceEnabled and
    // voiceReferenceData are part of cached LoadedPersonality used by ai-worker for TTS)
    const voiceSettingsChanged =
      body.voiceEnabled !== undefined ||
      mediaFields.voiceReferenceData !== undefined ||
      mediaFields.voiceReferenceType !== undefined;
    if (voiceSettingsChanged) {
      await invalidatePersonalityCache(personality.id, 'voice settings', cacheInvalidationService);
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
      'Updated personality'
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
  return [
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(createHandler(prisma, cacheInvalidationService)),
  ];
}
