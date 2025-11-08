/**
 * Admin Routes
 * Owner-only administrative endpoints
 */

import express, { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, getConfig } from '@tzurot/common-types';
import { PrismaClient } from '@prisma/client';
import { DatabaseSyncService } from '../services/DatabaseSyncService.js';
import { ErrorResponses, getStatusCode } from '../utils/errorResponses.js';
import { requireOwnerAuth } from '../services/AuthMiddleware.js';
import { optimizeAvatar } from '../utils/imageProcessor.js';

const logger = createLogger('admin-routes');
const router: Router = express.Router();
const prisma = new PrismaClient();

/**
 * POST /admin/db-sync
 * Bidirectional database synchronization between dev and prod
 */
router.post('/db-sync', requireOwnerAuth(), async (req: Request, res: Response) => {
  try {
    const { dryRun = false } = req.body;
    const config = getConfig();

    // Verify database URLs are configured
    if (!config.DEV_DATABASE_URL || !config.PROD_DATABASE_URL) {
      const errorResponse = ErrorResponses.configurationError(
        'Both DEV_DATABASE_URL and PROD_DATABASE_URL must be configured'
      );
      res.status(getStatusCode(errorResponse.error)).json(errorResponse);
      return;
    }

    logger.info({ dryRun }, '[Admin] Starting database sync');

    // Execute sync
    const syncService = new DatabaseSyncService(config.DEV_DATABASE_URL, config.PROD_DATABASE_URL);

    const result = await syncService.sync({ dryRun });

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
});

/**
 * POST /admin/personality
 * Create a new AI personality
 */
router.post('/personality', requireOwnerAuth(), async (req: Request, res: Response) => {
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
    } = req.body;

    // Validate required fields
    if (!name || !slug || !characterInfo || !personalityTraits) {
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

    // Check if personality already exists
    const existing = await prisma.personality.findUnique({
      where: { slug },
    });

    if (existing) {
      const errorResponse = ErrorResponses.conflict(
        `A personality with slug '${slug}' already exists`
      );
      res.status(getStatusCode(errorResponse.error)).json(errorResponse);
      return;
    }

    // Process avatar if provided
    let processedAvatarData: Buffer | undefined;
    if (avatarData) {
      try {
        logger.info(`[Admin] Processing avatar for personality: ${slug}`);

        const result = await optimizeAvatar(avatarData);

        logger.info(
          `[Admin] Avatar optimized: ${result.originalSizeKB} KB → ${result.processedSizeKB} KB (quality: ${result.quality})`
        );

        if (result.exceedsTarget) {
          logger.warn(
            `[Admin] Avatar still exceeds 200KB after optimization: ${result.processedSizeKB} KB`
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
        displayName: displayName || null,
        characterInfo,
        personalityTraits,
        personalityTone: personalityTone || null,
        personalityAge: personalityAge || null,
        personalityAppearance: personalityAppearance || null,
        personalityLikes: personalityLikes || null,
        personalityDislikes: personalityDislikes || null,
        conversationalGoals: conversationalGoals || null,
        conversationalExamples: conversationalExamples || null,
        customFields: customFields || null,
        avatarData: processedAvatarData ? new Uint8Array(processedAvatarData) : null,
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

      if (defaultLlmConfig) {
        await prisma.personalityDefaultConfig.create({
          data: {
            personalityId: personality.id,
            llmConfigId: defaultLlmConfig.id,
          },
        });
        logger.info(`[Admin] Set default LLM config for ${slug}: ${defaultLlmConfig.name}`);
      } else {
        logger.warn(
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
        hasAvatar: !!processedAvatarData,
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
});

/**
 * PATCH /admin/personality/:slug
 * Edit an existing AI personality
 */
router.patch('/personality/:slug', requireOwnerAuth(), async (req: Request, res: Response) => {
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
    } = req.body;

    // Check if personality exists
    const existing = await prisma.personality.findUnique({
      where: { slug },
    });

    if (!existing) {
      const errorResponse = ErrorResponses.notFound(`Personality with slug '${slug}'`);
      res.status(getStatusCode(errorResponse.error)).json(errorResponse);
      return;
    }

    // Process avatar if provided
    let processedAvatarData: Buffer | undefined;
    if (avatarData) {
      try {
        logger.info(`[Admin] Processing avatar update for personality: ${slug}`);

        const result = await optimizeAvatar(avatarData);

        logger.info(
          `[Admin] Avatar optimized: ${result.originalSizeKB} KB → ${result.processedSizeKB} KB (quality: ${result.quality})`
        );

        if (result.exceedsTarget) {
          logger.warn(
            `[Admin] Avatar still exceeds 200KB after optimization: ${result.processedSizeKB} KB`
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
    if (name !== undefined) updateData.name = name;
    if (characterInfo !== undefined) updateData.characterInfo = characterInfo;
    if (personalityTraits !== undefined) updateData.personalityTraits = personalityTraits;
    if (displayName !== undefined) updateData.displayName = displayName;
    if (personalityTone !== undefined) updateData.personalityTone = personalityTone;
    if (personalityAge !== undefined) updateData.personalityAge = personalityAge;
    if (personalityAppearance !== undefined)
      updateData.personalityAppearance = personalityAppearance;
    if (personalityLikes !== undefined) updateData.personalityLikes = personalityLikes;
    if (personalityDislikes !== undefined) updateData.personalityDislikes = personalityDislikes;
    if (conversationalGoals !== undefined) updateData.conversationalGoals = conversationalGoals;
    if (conversationalExamples !== undefined)
      updateData.conversationalExamples = conversationalExamples;
    if (customFields !== undefined) updateData.customFields = customFields;
    if (processedAvatarData !== undefined)
      updateData.avatarData = new Uint8Array(processedAvatarData);

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
        hasAvatar: !!personality.avatarData,
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
});

export { router as adminRouter };
