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
} from '@tzurot/common-types';
import { Prisma } from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { validateSlug } from '../../../utils/validators.js';
import { optimizeAvatar } from '../../../utils/imageProcessor.js';
import { deleteAllAvatarVersions } from '../../../utils/avatarPaths.js';
import type { AuthenticatedRequest } from '../../../types.js';
import { getParam } from '../../../utils/requestParams.js';
import { canUserEditPersonality } from './helpers.js';

const logger = createLogger('user-personality-update');

interface UpdatePersonalityBody {
  name?: string;
  displayName?: string | null;
  slug?: string;
  characterInfo?: string;
  personalityTraits?: string;
  personalityTone?: string | null;
  personalityAge?: string | null;
  personalityAppearance?: string | null;
  personalityLikes?: string | null;
  personalityDislikes?: string | null;
  conversationalGoals?: string | null;
  conversationalExamples?: string | null;
  errorMessage?: string | null;
  avatarData?: string;
}

const PERSONALITY_SELECT = {
  id: true,
  name: true,
  slug: true,
  displayName: true,
  characterInfo: true,
  personalityTraits: true,
  personalityTone: true,
  personalityAge: true,
  personalityAppearance: true,
  personalityLikes: true,
  personalityDislikes: true,
  conversationalGoals: true,
  conversationalExamples: true,
  errorMessage: true,
  birthMonth: true,
  birthDay: true,
  birthYear: true,
  isPublic: true,
  voiceEnabled: true,
  imageEnabled: true,
  ownerId: true,
  avatarData: true,
  customFields: true,
  systemPromptId: true,
  voiceSettings: true,
  imageSettings: true,
  createdAt: true,
  updatedAt: true,
} as const;

// --- Helper Functions ---

function buildUpdateData(
  body: UpdatePersonalityBody,
  existingName: string
): Prisma.PersonalityUpdateInput {
  const updateData: Prisma.PersonalityUpdateInput = {};

  const simpleFields: (keyof UpdatePersonalityBody)[] = [
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

async function processAvatarIfProvided(
  avatarData: string | undefined
): Promise<
  | { buffer: Uint8Array<ArrayBuffer> }
  | { error: ReturnType<typeof ErrorResponses.processingError> }
  | null
> {
  if (avatarData === undefined || avatarData.length === 0) {
    return null;
  }

  try {
    const result = await optimizeAvatar(avatarData);
    return { buffer: new Uint8Array(result.buffer) };
  } catch (error) {
    logger.error({ err: error }, '[User] Failed to process avatar');
    return { error: ErrorResponses.processingError('Failed to process avatar image.') };
  }
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

type PersonalityFromDb = Prisma.PersonalityGetPayload<{ select: typeof PERSONALITY_SELECT }>;

interface PersonalityResponse {
  id: string;
  name: string;
  slug: string;
  displayName: string | null;
  characterInfo: string;
  personalityTraits: string;
  personalityTone: string | null;
  personalityAge: string | null;
  personalityAppearance: string | null;
  personalityLikes: string | null;
  personalityDislikes: string | null;
  conversationalGoals: string | null;
  conversationalExamples: string | null;
  errorMessage: string | null;
  birthMonth: number | null;
  birthDay: number | null;
  birthYear: number | null;
  isPublic: boolean;
  voiceEnabled: boolean;
  imageEnabled: boolean;
  ownerId: string;
  hasAvatar: boolean;
  customFields: unknown;
  systemPromptId: string | null;
  voiceSettings: unknown;
  imageSettings: unknown;
  createdAt: string;
  updatedAt: string;
}

function formatResponse(updated: PersonalityFromDb): PersonalityResponse {
  return {
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    displayName: updated.displayName,
    characterInfo: updated.characterInfo,
    personalityTraits: updated.personalityTraits,
    personalityTone: updated.personalityTone,
    personalityAge: updated.personalityAge,
    personalityAppearance: updated.personalityAppearance,
    personalityLikes: updated.personalityLikes,
    personalityDislikes: updated.personalityDislikes,
    conversationalGoals: updated.conversationalGoals,
    conversationalExamples: updated.conversationalExamples,
    errorMessage: updated.errorMessage,
    birthMonth: updated.birthMonth,
    birthDay: updated.birthDay,
    birthYear: updated.birthYear,
    isPublic: updated.isPublic,
    voiceEnabled: updated.voiceEnabled,
    imageEnabled: updated.imageEnabled,
    ownerId: updated.ownerId,
    hasAvatar: updated.avatarData !== null,
    customFields: updated.customFields,
    systemPromptId: updated.systemPromptId,
    voiceSettings: updated.voiceSettings,
    imageSettings: updated.imageSettings,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
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

    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

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

    const body = req.body as UpdatePersonalityBody;

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

    const avatarResult = await processAvatarIfProvided(body.avatarData);
    if (avatarResult !== null && 'error' in avatarResult) {
      return sendError(res, avatarResult.error);
    }

    const avatarWasUpdated = avatarResult !== null;
    if (avatarWasUpdated) {
      updateData.avatarData = avatarResult.buffer;
    }

    const updated = await prisma.personality.update({
      where: { id: personality.id },
      data: updateData,
      select: PERSONALITY_SELECT,
    });

    if (avatarWasUpdated) {
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
        avatarUpdated: avatarWasUpdated,
        slugUpdated: slugWasUpdated,
      },
      '[User] Updated personality'
    );

    sendCustomSuccess(res, { success: true, personality: formatResponse(updated) }, StatusCodes.OK);
  };
}

// --- Route Factory ---

export function createUpdateHandler(
  prisma: PrismaClient,
  cacheInvalidationService?: CacheInvalidationService
): RequestHandler[] {
  return [requireUserAuth(), asyncHandler(createHandler(prisma, cacheInvalidationService))];
}
