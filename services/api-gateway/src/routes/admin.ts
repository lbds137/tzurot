/**
 * Admin Routes
 * Owner-only administrative endpoints
 */

import express, { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  getConfig,
  CacheInvalidationService,
  customFieldsSchema,
  AVATAR_LIMITS,
} from '@tzurot/common-types';
import { PrismaClient, Prisma } from '@prisma/client';
import { DatabaseSyncService } from '../services/DatabaseSyncService.js';
import { ErrorResponses, getStatusCode } from '../utils/errorResponses.js';
import { requireOwnerAuth } from '../services/AuthMiddleware.js';
import { optimizeAvatar } from '../utils/imageProcessor.js';

const logger = createLogger('admin-routes');

/**
 * Create admin router with injected dependencies
 * @param prisma - Prisma client for database operations
 * @param cacheInvalidationService - Service for invalidating personality caches across all services
 */
export function createAdminRouter(
  prisma: PrismaClient,
  cacheInvalidationService: CacheInvalidationService
): Router {
  const router: Router = express.Router();

  /**
   * POST /admin/db-sync
   * Bidirectional database synchronization between dev and prod
   */
  router.post('/db-sync', requireOwnerAuth(), (req: Request, res: Response) => {
    void (async () => {
      try {
        const { dryRun = false } = req.body as { dryRun?: boolean };
        const config = getConfig();

        // Verify database URLs are configured
        if (
          config.DEV_DATABASE_URL === undefined ||
          config.DEV_DATABASE_URL.length === 0 ||
          config.PROD_DATABASE_URL === undefined ||
          config.PROD_DATABASE_URL.length === 0
        ) {
          const errorResponse = ErrorResponses.configurationError(
            'Both DEV_DATABASE_URL and PROD_DATABASE_URL must be configured'
          );
          res.status(getStatusCode(errorResponse.error)).json(errorResponse);
          return;
        }

        logger.info({ dryRun }, '[Admin] Starting database sync');

        // Create Prisma clients for dev and prod databases
        const devClient = new PrismaClient({
          datasources: {
            db: { url: config.DEV_DATABASE_URL },
          },
        });

        const prodClient = new PrismaClient({
          datasources: {
            db: { url: config.PROD_DATABASE_URL },
          },
        });

        // Execute sync
        const syncService = new DatabaseSyncService(devClient, prodClient);

        const result = await syncService.sync({
          dryRun,
        });

        logger.info({ result }, '[Admin] Database sync complete');

        res.json({
          success: true,
          ...result,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, '[Admin] Database sync failed');

        const errorResponse = ErrorResponses.syncError(
          error instanceof Error ? error.message : 'Database sync failed'
        );

        res.status(getStatusCode(errorResponse.error)).json(errorResponse);
      }
    })();
  });

  /**
   * POST /admin/personality
   * Create a new AI personality
   */
  router.post('/personality', requireOwnerAuth(), (req: Request, res: Response) => {
    void (async () => {
      try {
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
        if (
          name === undefined ||
          name.length === 0 ||
          slug === undefined ||
          slug.length === 0 ||
          characterInfo === undefined ||
          characterInfo.length === 0 ||
          personalityTraits === undefined ||
          personalityTraits.length === 0
        ) {
          const errorResponse = ErrorResponses.validationError(
            'Missing required fields: name, slug, characterInfo, personalityTraits'
          );
          res.status(getStatusCode(errorResponse.error)).json(errorResponse);
          return;
        }

        // Validate slug format
        if (!/^[a-z0-9-]+$/.test(slug)) {
          const errorResponse = ErrorResponses.validationError(
            'Invalid slug format. Use only lowercase letters, numbers, and hyphens.'
          );
          res.status(getStatusCode(errorResponse.error)).json(errorResponse);
          return;
        }

        // Validate customFields if provided
        if (customFields !== undefined && customFields !== null) {
          const validation = customFieldsSchema.safeParse(customFields);
          if (!validation.success) {
            const errorResponse = ErrorResponses.validationError(
              `Invalid customFields: ${validation.error.message}`
            );
            res.status(getStatusCode(errorResponse.error)).json(errorResponse);
            return;
          }
        }

        // Check if personality already exists
        const existing = await prisma.personality.findUnique({
          where: { slug },
        });

        if (existing !== null) {
          const errorResponse = ErrorResponses.conflict(
            `A personality with slug '${slug}' already exists`
          );
          res.status(getStatusCode(errorResponse.error)).json(errorResponse);
          return;
        }

        // Process avatar if provided
        let processedAvatarData: Buffer | undefined;
        if (avatarData !== undefined && avatarData.length > 0) {
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

            processedAvatarData = result.buffer;
          } catch (error) {
            logger.error({ err: error }, '[Admin] Failed to process avatar');
            const errorResponse = ErrorResponses.processingError(
              'Failed to process avatar image. Ensure it is a valid image file.'
            );
            res.status(getStatusCode(errorResponse.error)).json(errorResponse);
            return;
          }
        }

        // Create personality in database
        const personality = await prisma.personality.create({
          data: {
            name,
            slug,
            displayName: displayName ?? null,
            characterInfo,
            personalityTraits,
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

        logger.info(`[Admin] Created personality: ${slug} (${personality.id})`);

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
            logger.info(`[Admin] Set default LLM config for ${slug}: ${defaultLlmConfig.name}`);
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

        res.status(StatusCodes.CREATED).json({
          success: true,
          personality: {
            id: personality.id,
            name: personality.name,
            slug: personality.slug,
            displayName: personality.displayName,
            hasAvatar: processedAvatarData !== undefined,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, '[Admin] Failed to create personality');

        const errorResponse = ErrorResponses.internalError(
          error instanceof Error ? error.message : 'Failed to create personality'
        );

        res.status(getStatusCode(errorResponse.error)).json(errorResponse);
      }
    })();
  });

  /**
   * PATCH /admin/personality/:slug
   * Edit an existing AI personality
   */
  router.patch('/personality/:slug', requireOwnerAuth(), (req: Request, res: Response) => {
    void (async () => {
      try {
        const { slug } = req.params;
        const {
          name,
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

        // Check if personality exists
        const existing = await prisma.personality.findUnique({
          where: { slug },
        });

        if (existing === null) {
          const errorResponse = ErrorResponses.notFound(`Personality with slug '${slug}'`);
          res.status(getStatusCode(errorResponse.error)).json(errorResponse);
          return;
        }

        // Validate customFields if provided
        if (customFields !== undefined && customFields !== null) {
          const validation = customFieldsSchema.safeParse(customFields);
          if (!validation.success) {
            const errorResponse = ErrorResponses.validationError(
              `Invalid customFields: ${validation.error.message}`
            );
            res.status(getStatusCode(errorResponse.error)).json(errorResponse);
            return;
          }
        }

        // Process avatar if provided
        let processedAvatarData: Buffer | undefined;
        if (avatarData !== undefined && avatarData.length > 0) {
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

            processedAvatarData = result.buffer;
          } catch (error) {
            logger.error({ err: error }, '[Admin] Failed to process avatar');
            const errorResponse = ErrorResponses.processingError(
              'Failed to process avatar image. Ensure it is a valid image file.'
            );
            res.status(getStatusCode(errorResponse.error)).json(errorResponse);
            return;
          }
        }

        // Build update data object with only provided fields
        const updateData: Record<string, unknown> = {};
        if (name !== undefined) {
          updateData.name = name;
        }
        if (characterInfo !== undefined) {
          updateData.characterInfo = characterInfo;
        }
        if (personalityTraits !== undefined) {
          updateData.personalityTraits = personalityTraits;
        }
        if (displayName !== undefined) {
          updateData.displayName = displayName;
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
        if (customFields !== undefined) {
          updateData.customFields = customFields;
        }
        if (processedAvatarData !== undefined) {
          updateData.avatarData = new Uint8Array(processedAvatarData);
        }

        // Update personality in database
        const personality = await prisma.personality.update({
          where: { slug },
          data: updateData,
        });

        logger.info(`[Admin] Updated personality: ${slug} (${personality.id})`);

        res.json({
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
      } catch (error) {
        logger.error({ err: error }, '[Admin] Failed to edit personality');

        const errorResponse = ErrorResponses.internalError(
          error instanceof Error ? error.message : 'Failed to edit personality'
        );

        res.status(getStatusCode(errorResponse.error)).json(errorResponse);
      }
    })();
  });

  /**
   * POST /admin/invalidate-cache
   * Manually trigger cache invalidation for personality configurations
   * Use after manually updating database (llm_configs, personalities, etc.)
   */
  router.post('/invalidate-cache', requireOwnerAuth(), (req: Request, res: Response) => {
    void (async () => {
      try {
        const { personalityId, all = false } = req.body as {
          personalityId?: string;
          all?: boolean;
        };

        if (all) {
          // Invalidate all personality caches
          await cacheInvalidationService.invalidateAll();
          logger.info('[Admin] Invalidated all personality caches');

          res.json({
            success: true,
            invalidated: 'all',
            message: 'All personality caches invalidated across all services',
            timestamp: new Date().toISOString(),
          });
        } else if (personalityId !== undefined && personalityId.length > 0) {
          // Invalidate specific personality cache
          await cacheInvalidationService.invalidatePersonality(personalityId);
          logger.info(`[Admin] Invalidated cache for personality: ${personalityId}`);

          res.json({
            success: true,
            invalidated: personalityId,
            message: `Cache invalidated for personality ${personalityId} across all services`,
            timestamp: new Date().toISOString(),
          });
        } else {
          const errorResponse = ErrorResponses.validationError(
            'Must provide either "personalityId" or "all: true"'
          );
          res.status(getStatusCode(errorResponse.error)).json(errorResponse);
        }
      } catch (error) {
        logger.error({ err: error }, '[Admin] Failed to invalidate cache');

        const errorResponse = ErrorResponses.internalError(
          error instanceof Error ? error.message : 'Failed to invalidate cache'
        );

        res.status(getStatusCode(errorResponse.error)).json(errorResponse);
      }
    })();
  });

  return router;
}
