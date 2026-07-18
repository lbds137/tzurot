/**
 * PUT /user/personality/:slug
 * Update an owned personality
 */

import { type Response, type RequestHandler } from 'express';
import {
  GetPersonalityResponseSchema,
  PersonalityUpdateSchema,
  type PersonalityUpdateInput,
  PERSONALITY_DETAIL_SELECT,
} from '@tzurot/common-types/schemas/api/personality';
import { type PrismaClient, type Prisma } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { type CacheInvalidationService } from '@tzurot/cache-invalidation';
import { requireUserAuth, requireProvisionedUser } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendContractSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses, type ErrorResponse } from '../../../utils/errorResponses.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import { validateSlug } from '../../../utils/validators.js';
import { processAvatarData } from '../../../utils/avatarProcessor.js';
import { processVoiceReferenceData } from '../../../utils/voiceReferenceProcessor.js';
import { deleteAllAvatarVersions } from '../../../utils/avatarPaths.js';
import type { ProvisionedRequest } from '../../../types.js';
import { getParam } from '../../../utils/requestParams.js';
import { findShadowedGlobalAliases, resolvePersonalityForEdit } from './helpers.js';
import { formatPersonalityResponse } from './formatters.js';
import type { RouteDeps } from '../../routeDeps.js';

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
    'definitionPublic',
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

  // Avatar: explicit clear takes precedence (`avatarData: null` means "no
  // change" per the dashboard round-trip, so clearing needs the distinct
  // `clearAvatar` flag). Only the AVATAR branch is skipped on clear — the voice
  // block below still runs, so a request that clears the avatar AND changes
  // voice in one body is honored for both.
  let avatarUpdated = false;
  if (body.clearAvatar === true) {
    mediaFields.avatarData = null;
    avatarUpdated = true;
  } else {
    const avatarResult = await processAvatarData(body.avatarData, slug);
    if (avatarResult !== null) {
      if (!avatarResult.ok) {
        return { avatarUpdated: false, mediaFields, error: avatarResult.error };
      }
      avatarUpdated = true;
      mediaFields.avatarData = new Uint8Array(avatarResult.buffer);
    }
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

/**
 * Slug changes are bot-owner-only, must pass format validation, and must
 * not collide with an existing slug. Sends the error response itself and
 * returns false when the update must stop; true when no slug change was
 * requested or the change is permitted.
 */
async function checkSlugUpdatePermission(options: {
  prisma: PrismaClient;
  res: Response;
  discordUserId: string;
  currentSlug: string;
  newSlug: string | undefined;
  personalityId: string;
}): Promise<boolean> {
  const { prisma, res, discordUserId, currentSlug, newSlug, personalityId } = options;
  if (newSlug === undefined || newSlug === currentSlug) {
    return true;
  }

  if (!isBotOwner(discordUserId)) {
    logger.warn(
      { discordUserId, currentSlug, attemptedSlug: newSlug },
      'Non-admin attempted slug update'
    );
    sendError(res, ErrorResponses.unauthorized('Only bot admins can update personality slugs'));
    return false;
  }

  // Validate slug format
  const slugValidation = validateSlug(newSlug);
  if (!slugValidation.valid) {
    sendError(res, slugValidation.error);
    return false;
  }

  // Check uniqueness - ensure new slug doesn't already exist
  const existingWithSlug = await prisma.personality.findUnique({
    where: { slug: newSlug },
    select: { id: true },
  });
  if (existingWithSlug !== null) {
    sendError(res, ErrorResponses.validationError(`Slug "${newSlug}" is already in use`));
    return false;
  }

  logger.info(
    { discordUserId, oldSlug: currentSlug, newSlug, personalityId },
    'Bot admin updating personality slug'
  );
  return true;
}

/**
 * Reverse-shadow check (warn, don't block), run only when the name or slug
 * actually changed: a renamed character whose new name/slug equals an
 * existing GLOBAL alias silently kills that alias (names/slugs win at
 * resolution). The rename stands; the returned field — empty when nothing
 * is shadowed, so the response omits it — carries the shadowed rows.
 */
async function buildRenameShadowField(options: {
  prisma: PrismaClient;
  body: { name?: string };
  previousName: string;
  slugWasUpdated: boolean;
  updated: { name: string; slug: string };
}): Promise<{ shadowedAliases?: string[] }> {
  const { prisma, body, previousName, slugWasUpdated, updated } = options;
  const nameWasUpdated = body.name !== undefined && body.name !== previousName;
  if (!nameWasUpdated && !slugWasUpdated) {
    return {};
  }
  const shadowedAliases = await findShadowedGlobalAliases(prisma, updated.name, updated.slug);
  return shadowedAliases.length > 0 ? { shadowedAliases } : {};
}

// --- Handler Factory ---

function createHandler(prisma: PrismaClient, cacheInvalidationService?: CacheInvalidationService) {
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const slug = getParam(req.params.slug);
    if (slug === undefined || slug === '') {
      return sendError(res, ErrorResponses.validationError('slug is required'));
    }

    const resolved = await resolvePersonalityForEdit<{
      id: string;
      ownerId: string;
      name: string;
    }>({
      prisma,
      req,
      slug,
      res,
      options: { select: { id: true, ownerId: true, name: true } },
    });
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

    // Field-level permission check: slug updates require bot owner. Sends
    // the error itself; false = respond-and-return.
    const slugUpdateOk = await checkSlugUpdatePermission({
      prisma,
      res,
      discordUserId,
      currentSlug: slug,
      newSlug: body.slug,
      personalityId: personality.id,
    });
    if (!slugUpdateOk) {
      return;
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

    const shadowField = await buildRenameShadowField({
      prisma,
      body,
      previousName: personality.name,
      slugWasUpdated,
      updated,
    });

    // canEdit: true is exact, not optimistic: the resolvePersonalityForEdit
    // gate above already proved this requester can edit (reaching here
    // otherwise is impossible). The schema argument pins the payload to the
    // declared contract at compile time.
    sendContractSuccess(res, GetPersonalityResponseSchema, {
      // Owner-only route (the update already passed the edit gate) — never redact.
      personality: formatPersonalityResponse(updated, { redact: false }),
      canEdit: true,
      ...shadowField,
    });
  };
}

// --- Handler factory + route chain ---

export const handleUpdatePersonality = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createHandler(deps.prisma, deps.cacheInvalidationService));

export function createUpdateHandler(deps: RouteDeps): RequestHandler[] {
  return [requireUserAuth(), requireProvisionedUser(deps.prisma), handleUpdatePersonality(deps)];
}
