/* eslint-disable max-lines */
// TODO: TECH DEBT - Split this 650+ line file into separate route modules:
// - list.ts (list personalities)
// - get.ts (get single personality)
// - create.ts (create personality)
// - update.ts (update personality with avatar cache invalidation)
// - visibility.ts (toggle visibility)
// - delete.ts (delete personality with cascade cleanup)

/**
 * User Personality Routes
 * CRUD operations for user-owned personalities (characters)
 *
 * Endpoints:
 * - GET /user/personality - List personalities visible to the user
 * - GET /user/personality/:slug - Get a single personality (if visible)
 * - POST /user/personality - Create a new personality
 * - PUT /user/personality/:slug - Update an owned personality
 * - PATCH /user/personality/:slug/visibility - Toggle visibility
 * - DELETE /user/personality/:slug - Delete an owned personality and all related data
 */

import { Router, type Response } from 'express';
import { deleteAvatarFile } from '../../utils/avatarPaths.js';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  type PersonalitySummary,
  type CacheInvalidationService,
  AVATAR_LIMITS,
  assertDefined,
  isBotOwner,
  DeletePersonalityResponseSchema,
  type DeletePersonalityResponse,
} from '@tzurot/common-types';
import { Prisma } from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { validateSlug, validateRequired } from '../../utils/validators.js';
import { optimizeAvatar } from '../../utils/imageProcessor.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('user-personality');

/**
 * Helper to get or create internal user from Discord ID
 */
async function getOrCreateInternalUser(
  prisma: PrismaClient,
  discordUserId: string
): Promise<{ id: string }> {
  let user = await prisma.user.findFirst({
    where: { discordId: discordUserId },
    select: { id: true },
  });

  // Create user if they don't exist
  user ??= await prisma.user.create({
    data: {
      discordId: discordUserId,
      username: discordUserId, // Placeholder - will be updated on next Discord interaction
    },
    select: { id: true },
  });

  return user;
}

/**
 * Check if user can edit a personality (owns it directly or via PersonalityOwner)
 * Bot owner can edit any personality.
 *
 * @param prisma - Prisma client
 * @param userId - Internal database user ID
 * @param personalityId - Personality ID to check
 * @param discordUserId - Discord user ID (for bot owner check)
 */
async function canUserEditPersonality(
  prisma: PrismaClient,
  userId: string,
  personalityId: string,
  discordUserId?: string
): Promise<boolean> {
  // Bot owner bypass - can edit any personality
  if (discordUserId !== undefined && isBotOwner(discordUserId)) {
    return true;
  }

  // Check direct ownership
  const personality = await prisma.personality.findUnique({
    where: { id: personalityId },
    select: { ownerId: true },
  });

  if (personality?.ownerId === userId) {
    return true;
  }

  // Check PersonalityOwner table (composite key: personalityId_userId)
  const ownerEntry = await prisma.personalityOwner.findUnique({
    where: {
      personalityId_userId: {
        personalityId,
        userId,
      },
    },
  });

  return ownerEntry !== null;
}

export function createPersonalityRoutes(
  prisma: PrismaClient,
  cacheInvalidationService?: CacheInvalidationService
): Router {
  const router = Router();

  /**
   * GET /user/personality
   * List all personalities visible to the user
   * - Public personalities (isPublic = true)
   * - User-owned personalities (ownerId = user.id OR PersonalityOwner entry)
   */
  router.get(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const isAdmin = isBotOwner(discordUserId);

      // Get user's internal ID
      const user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
        select: { id: true },
      });

      // Bot owner gets ALL personalities and can edit any of them
      if (isAdmin) {
        const allPersonalities = await prisma.personality.findMany({
          select: {
            id: true,
            name: true,
            displayName: true,
            slug: true,
            ownerId: true,
            isPublic: true,
            owner: {
              select: { discordId: true },
            },
          },
          orderBy: { name: 'asc' },
        });

        const personalities: PersonalitySummary[] = allPersonalities.map(p => ({
          id: p.id,
          name: p.name,
          displayName: p.displayName,
          slug: p.slug,
          isOwned: true, // Bot owner "owns" all for edit/avatar purposes
          isPublic: p.isPublic,
          ownerId: p.ownerId,
          ownerDiscordId: p.owner?.discordId ?? null,
        }));

        logger.info(
          { discordUserId, isAdmin: true, totalCount: personalities.length },
          '[Personality] Listed all personalities (admin)'
        );

        return sendCustomSuccess(res, { personalities }, StatusCodes.OK);
      }

      // Regular user flow
      // Get public personalities (with owner's Discord ID for display)
      const publicPersonalities = await prisma.personality.findMany({
        where: { isPublic: true },
        select: {
          id: true,
          name: true,
          displayName: true,
          slug: true,
          ownerId: true,
          isPublic: true,
          owner: {
            select: { discordId: true },
          },
        },
        orderBy: { name: 'asc' },
      });

      // Get user-owned private personalities (if user exists)
      let userOwnedPersonalities: typeof publicPersonalities = [];

      if (user !== null) {
        // Get personalities user owns directly or via PersonalityOwner
        const ownedIds = await prisma.personalityOwner.findMany({
          where: { userId: user.id },
          select: { personalityId: true },
        });

        const ownedIdSet = new Set(ownedIds.map(o => o.personalityId));

        userOwnedPersonalities = await prisma.personality.findMany({
          where: {
            isPublic: false,
            OR: [{ ownerId: user.id }, { id: { in: Array.from(ownedIdSet) } }],
          },
          select: {
            id: true,
            name: true,
            displayName: true,
            slug: true,
            ownerId: true,
            isPublic: true,
            owner: {
              select: { discordId: true },
            },
          },
          orderBy: { name: 'asc' },
        });
      }

      // Combine and format results
      const publicIds = new Set(publicPersonalities.map(p => p.id));
      const userOwnerId = user?.id;

      const personalities: PersonalitySummary[] = [
        ...publicPersonalities.map(p => ({
          id: p.id,
          name: p.name,
          displayName: p.displayName,
          slug: p.slug,
          isOwned: p.ownerId === userOwnerId,
          isPublic: p.isPublic,
          ownerId: p.ownerId,
          ownerDiscordId: p.owner?.discordId ?? null,
        })),
        // Add user-owned private personalities that aren't already in the public list
        ...userOwnedPersonalities
          .filter(p => !publicIds.has(p.id))
          .map(p => ({
            id: p.id,
            name: p.name,
            displayName: p.displayName,
            slug: p.slug,
            isOwned: true,
            isPublic: p.isPublic,
            ownerId: p.ownerId,
            ownerDiscordId: p.owner?.discordId ?? null,
          })),
      ];

      logger.info(
        {
          discordUserId,
          publicCount: publicPersonalities.length,
          privateCount: userOwnedPersonalities.length,
          totalCount: personalities.length,
        },
        '[Personality] Listed personalities'
      );

      sendCustomSuccess(res, { personalities }, StatusCodes.OK);
    })
  );

  /**
   * GET /user/personality/:slug
   * Get a single personality by slug (if visible to user)
   */
  router.get(
    '/:slug',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const { slug } = req.params;

      // Get user's internal ID
      const user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
        select: { id: true },
      });

      // Find personality
      const personality = await prisma.personality.findUnique({
        where: { slug },
        select: {
          id: true,
          name: true,
          displayName: true,
          slug: true,
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
          createdAt: true,
          updatedAt: true,
        },
      });

      if (personality === null) {
        return sendError(res, ErrorResponses.notFound('Personality not found'));
      }

      // Check if user can view this personality
      // Bot owner can view any personality
      const isAdmin = isBotOwner(discordUserId);
      const isOwner = user !== null && personality.ownerId === user.id;
      let hasAccess = isAdmin || personality.isPublic || isOwner;

      // Check PersonalityOwner table if not already accessible
      if (!hasAccess && user !== null) {
        const ownerEntry = await prisma.personalityOwner.findUnique({
          where: {
            personalityId_userId: {
              personalityId: personality.id,
              userId: user.id,
            },
          },
        });
        hasAccess = ownerEntry !== null;
      }

      if (!hasAccess) {
        return sendError(
          res,
          ErrorResponses.unauthorized('You do not have access to this personality')
        );
      }

      // Return personality data
      const canEdit =
        user !== null &&
        (await canUserEditPersonality(prisma, user.id, personality.id, discordUserId));

      logger.info({ discordUserId, slug, canEdit }, '[Personality] Retrieved personality');

      sendCustomSuccess(
        res,
        {
          personality: {
            id: personality.id,
            name: personality.name,
            displayName: personality.displayName,
            slug: personality.slug,
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
            birthMonth: personality.birthMonth,
            birthDay: personality.birthDay,
            birthYear: personality.birthYear,
            isPublic: personality.isPublic,
            voiceEnabled: personality.voiceEnabled,
            imageEnabled: personality.imageEnabled,
            ownerId: personality.ownerId,
            hasAvatar: personality.avatarData !== null,
            createdAt: personality.createdAt.toISOString(),
            updatedAt: personality.updatedAt.toISOString(),
          },
          canEdit,
        },
        StatusCodes.OK
      );
    })
  );

  /**
   * POST /user/personality
   * Create a new personality owned by the user
   */
  router.post(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
        errorMessage?: string | null;
        isPublic?: boolean;
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
      // If displayName not provided, default to name
      const personality = await prisma.personality.create({
        data: {
          name,
          slug,
          displayName: displayName ?? name,
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
          avatarData:
            processedAvatarData !== undefined ? new Uint8Array(processedAvatarData) : null,
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
    })
  );

  /**
   * PUT /user/personality/:slug
   * Update an owned personality
   */
  router.put(
    '/:slug',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const { slug } = req.params;

      // Get user
      const user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
        select: { id: true },
      });

      if (user === null) {
        return sendError(res, ErrorResponses.unauthorized('User not found'));
      }

      // Find personality
      const personality = await prisma.personality.findUnique({
        where: { slug },
        select: { id: true, ownerId: true },
      });

      if (personality === null) {
        return sendError(res, ErrorResponses.notFound('Personality not found'));
      }

      // Check ownership (bot owner can edit any personality)
      const canEdit = await canUserEditPersonality(prisma, user.id, personality.id, discordUserId);
      if (!canEdit) {
        return sendError(
          res,
          ErrorResponses.unauthorized('You do not have permission to edit this personality')
        );
      }

      const {
        name,
        displayName,
        characterInfo,
        personalityTraits,
        personalityTone,
        personalityAge,
        personalityAppearance,
        personalityLikes,
        personalityDislikes,
        conversationalGoals,
        conversationalExamples,
        errorMessage,
        avatarData,
      } = req.body as {
        name?: string;
        displayName?: string | null;
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
      };

      // Build update data (only include fields that were provided)
      const updateData: Prisma.PersonalityUpdateInput = {};

      if (name !== undefined) {
        updateData.name = name;
      }
      if (displayName !== undefined) {
        updateData.displayName = displayName;
      }
      if (characterInfo !== undefined) {
        updateData.characterInfo = characterInfo;
      }
      if (personalityTraits !== undefined) {
        updateData.personalityTraits = personalityTraits;
      }
      if (personalityTone !== undefined) {
        updateData.personalityTone = personalityTone;
      }
      if (personalityAge !== undefined) {
        updateData.personalityAge = personalityAge;
      }
      if (personalityAppearance !== undefined) {
        updateData.personalityAppearance = personalityAppearance;
      }
      if (personalityLikes !== undefined) {
        updateData.personalityLikes = personalityLikes;
      }
      if (personalityDislikes !== undefined) {
        updateData.personalityDislikes = personalityDislikes;
      }
      if (conversationalGoals !== undefined) {
        updateData.conversationalGoals = conversationalGoals;
      }
      if (conversationalExamples !== undefined) {
        updateData.conversationalExamples = conversationalExamples;
      }
      if (errorMessage !== undefined) {
        updateData.errorMessage = errorMessage;
      }

      // Process avatar if provided
      const avatarWasUpdated = avatarData !== undefined && avatarData.length > 0;
      if (avatarWasUpdated) {
        try {
          const result = await optimizeAvatar(avatarData);
          updateData.avatarData = new Uint8Array(result.buffer);
        } catch (error) {
          logger.error({ err: error }, '[User] Failed to process avatar');
          return sendError(res, ErrorResponses.processingError('Failed to process avatar image.'));
        }
      }

      // Update personality - select ALL fields needed for dashboard refresh
      const updated = await prisma.personality.update({
        where: { id: personality.id },
        data: updateData,
        select: {
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
          createdAt: true,
          updatedAt: true,
        },
      });

      // If avatar was updated, invalidate caches
      if (avatarWasUpdated) {
        // 1. Delete filesystem cache (avatars are cached at /data/avatars/<slug>.png)
        await deleteAvatarFile(slug, 'User avatar update');

        // 2. Invalidate in-memory personality cache across all services
        if (cacheInvalidationService) {
          try {
            await cacheInvalidationService.invalidatePersonality(personality.id);
            logger.info(
              { personalityId: personality.id },
              '[User] Invalidated personality cache after avatar update'
            );
          } catch (error) {
            // Log but don't fail the request - cache will expire via TTL
            logger.warn(
              { err: error, personalityId: personality.id },
              '[User] Failed to invalidate personality cache'
            );
          }
        }
      }

      logger.info(
        { discordUserId, slug, personalityId: personality.id, avatarUpdated: avatarWasUpdated },
        '[User] Updated personality'
      );

      // Return full personality data for dashboard refresh
      sendCustomSuccess(
        res,
        {
          success: true,
          personality: {
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
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
          },
        },
        StatusCodes.OK
      );
    })
  );

  /**
   * PATCH /user/personality/:slug/visibility
   * Toggle visibility of an owned personality
   */
  router.patch(
    '/:slug/visibility',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const { slug } = req.params;
      const { isPublic } = req.body as { isPublic?: boolean };

      if (isPublic === undefined) {
        return sendError(res, ErrorResponses.validationError('isPublic field is required'));
      }

      // Get user
      const user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
        select: { id: true },
      });

      if (user === null) {
        return sendError(res, ErrorResponses.unauthorized('User not found'));
      }

      // Find personality
      const personality = await prisma.personality.findUnique({
        where: { slug },
        select: { id: true, ownerId: true, isPublic: true },
      });

      if (personality === null) {
        return sendError(res, ErrorResponses.notFound('Personality not found'));
      }

      // Check ownership (bot owner can change any personality's visibility)
      const canEdit = await canUserEditPersonality(prisma, user.id, personality.id, discordUserId);
      if (!canEdit) {
        return sendError(
          res,
          ErrorResponses.unauthorized('You do not have permission to change visibility')
        );
      }

      // Update visibility
      const updated = await prisma.personality.update({
        where: { id: personality.id },
        data: { isPublic },
        select: { id: true, slug: true, isPublic: true },
      });

      logger.info(
        { discordUserId, slug, oldValue: personality.isPublic, newValue: isPublic },
        '[User] Changed personality visibility'
      );

      sendCustomSuccess(
        res,
        {
          success: true,
          personality: {
            id: updated.id,
            slug: updated.slug,
            isPublic: updated.isPublic,
          },
        },
        StatusCodes.OK
      );
    })
  );

  /**
   * DELETE /user/personality/:slug
   * Delete a personality and all associated data (owned personalities only)
   *
   * This is a destructive operation that:
   * 1. Deletes PendingMemory records manually (no FK cascade)
   * 2. Deletes the personality (Prisma cascades ConversationHistory, Memory, Aliases, etc.)
   * 3. Deletes cached avatar file
   * 4. Invalidates personality cache
   */
  router.delete(
    '/:slug',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const { slug } = req.params;

      // Get user
      const user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
        select: { id: true },
      });

      if (user === null) {
        return sendError(res, ErrorResponses.unauthorized('User not found'));
      }

      // Find personality with data for deletion counts
      const personality = await prisma.personality.findUnique({
        where: { slug },
        select: {
          id: true,
          name: true,
          ownerId: true,
          _count: {
            select: {
              conversationHistory: true,
              memories: true,
              activatedChannels: true,
              aliases: true,
            },
          },
        },
      });

      if (personality === null) {
        return sendError(res, ErrorResponses.notFound('Personality not found'));
      }

      // Check ownership (bot owner can delete any personality)
      const canDelete = await canUserEditPersonality(
        prisma,
        user.id,
        personality.id,
        discordUserId
      );
      if (!canDelete) {
        return sendError(
          res,
          ErrorResponses.unauthorized('You do not have permission to delete this personality')
        );
      }

      // Count PendingMemory records (need manual deletion - no FK cascade)
      const pendingMemoryCount = await prisma.pendingMemory.count({
        where: { personalityId: personality.id },
      });

      // Store counts before deletion
      const deletedCounts = {
        conversationHistory: personality._count.conversationHistory,
        memories: personality._count.memories,
        pendingMemories: pendingMemoryCount,
        activatedChannels: personality._count.activatedChannels,
        aliases: personality._count.aliases,
      };

      logger.info(
        {
          discordUserId,
          slug,
          personalityId: personality.id,
          deletedCounts,
        },
        '[Personality] Starting deletion'
      );

      // 1. Delete PendingMemory records first (no FK cascade)
      if (pendingMemoryCount > 0) {
        await prisma.pendingMemory.deleteMany({
          where: { personalityId: personality.id },
        });
        logger.debug(
          { personalityId: personality.id, count: pendingMemoryCount },
          '[Personality] Deleted PendingMemory records'
        );
      }

      // 2. Delete personality (Prisma cascades ConversationHistory, Memory, Aliases, etc.)
      await prisma.personality.delete({
        where: { id: personality.id },
      });

      // 3. Delete cached avatar file
      await deleteAvatarFile(slug, 'Personality delete');

      // 4. Invalidate personality cache
      if (cacheInvalidationService) {
        try {
          await cacheInvalidationService.invalidatePersonality(personality.id);
          logger.debug(
            { personalityId: personality.id },
            '[Personality] Invalidated cache after deletion'
          );
        } catch (error) {
          logger.warn(
            { err: error, personalityId: personality.id },
            '[Personality] Failed to invalidate cache'
          );
        }
      }

      logger.info(
        { discordUserId, slug, deletedCounts },
        '[Personality] Successfully deleted personality and all related data'
      );

      // Build response matching the schema
      const response: DeletePersonalityResponse = {
        success: true,
        deletedSlug: slug,
        deletedName: personality.name,
        deletedCounts,
      };

      // Validate response against schema before sending
      const validated = DeletePersonalityResponseSchema.parse(response);
      sendCustomSuccess(res, validated, StatusCodes.OK);
    })
  );

  return router;
}
