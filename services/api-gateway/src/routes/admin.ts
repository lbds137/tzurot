/**
 * Admin Routes
 * Owner-only administrative endpoints
 */

import express, { Request, Response, Router } from 'express';
import { createLogger, getConfig } from '@tzurot/common-types';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { DatabaseSyncService } from '../services/DatabaseSyncService.js';
import type { ErrorResponse } from '../types.js';

const logger = createLogger('admin-routes');
const router: Router = express.Router();
const prisma = new PrismaClient();

/**
 * POST /admin/db-sync
 * Bidirectional database synchronization between dev and prod
 */
router.post('/db-sync', async (req: Request, res: Response) => {
  try {
    const { dryRun = false, ownerId } = req.body;
    const config = getConfig();

    // Verify owner authorization
    if (!ownerId || !config.BOT_OWNER_ID || ownerId !== config.BOT_OWNER_ID) {
      const errorResponse: ErrorResponse = {
        error: 'UNAUTHORIZED',
        message: 'This endpoint is only available to the bot owner',
        timestamp: new Date().toISOString()
      };
      res.status(403).json(errorResponse);
      return;
    }

    // Verify database URLs are configured
    if (!config.DEV_DATABASE_URL || !config.PROD_DATABASE_URL) {
      const errorResponse: ErrorResponse = {
        error: 'CONFIGURATION_ERROR',
        message: 'Both DEV_DATABASE_URL and PROD_DATABASE_URL must be configured',
        timestamp: new Date().toISOString()
      };
      res.status(500).json(errorResponse);
      return;
    }

    logger.info({ dryRun }, '[Admin] Starting database sync');

    // Execute sync
    const syncService = new DatabaseSyncService(
      config.DEV_DATABASE_URL,
      config.PROD_DATABASE_URL
    );

    const result = await syncService.sync({ dryRun });

    logger.info({ result }, '[Admin] Database sync complete');

    res.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error({ err: error }, '[Admin] Database sync failed');

    const errorResponse: ErrorResponse = {
      error: 'SYNC_ERROR',
      message: error instanceof Error ? error.message : 'Database sync failed',
      timestamp: new Date().toISOString()
    };

    res.status(500).json(errorResponse);
  }
});

/**
 * POST /admin/personality
 * Create a new AI personality
 */
router.post('/personality', async (req: Request, res: Response) => {
  try {
    const ownerId = req.headers['x-owner-id'] as string;
    const config = getConfig();

    // Verify owner authorization
    if (!ownerId || !config.BOT_OWNER_ID || ownerId !== config.BOT_OWNER_ID) {
      const errorResponse: ErrorResponse = {
        error: 'UNAUTHORIZED',
        message: 'This endpoint is only available to the bot owner',
        timestamp: new Date().toISOString()
      };
      res.status(403).json(errorResponse);
      return;
    }

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
      avatarData
    } = req.body;

    // Validate required fields
    if (!name || !slug || !characterInfo || !personalityTraits) {
      const errorResponse: ErrorResponse = {
        error: 'VALIDATION_ERROR',
        message: 'Missing required fields: name, slug, characterInfo, personalityTraits',
        timestamp: new Date().toISOString()
      };
      res.status(400).json(errorResponse);
      return;
    }

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      const errorResponse: ErrorResponse = {
        error: 'VALIDATION_ERROR',
        message: 'Invalid slug format. Use only lowercase letters, numbers, and hyphens.',
        timestamp: new Date().toISOString()
      };
      res.status(400).json(errorResponse);
      return;
    }

    // Check if personality already exists
    const existing = await prisma.personality.findUnique({
      where: { slug }
    });

    if (existing) {
      const errorResponse: ErrorResponse = {
        error: 'CONFLICT',
        message: `A personality with slug '${slug}' already exists`,
        timestamp: new Date().toISOString()
      };
      res.status(409).json(errorResponse);
      return;
    }

    // Process avatar if provided
    let processedAvatarData: Buffer | undefined;
    if (avatarData) {
      try {
        logger.info(`[Admin] Processing avatar for personality: ${slug}`);

        // Decode base64
        const buffer = Buffer.from(avatarData, 'base64');
        const originalSizeKB = (buffer.length / 1024).toFixed(2);
        logger.info(`[Admin] Original avatar size: ${originalSizeKB} KB`);

        // Resize and optimize image
        // Target: 256x256, PNG format, quality adjusted to stay under 200KB
        let quality = 90;
        let processed = await sharp(buffer)
          .resize(256, 256, {
            fit: 'cover',
            position: 'center'
          })
          .png({ quality })
          .toBuffer();

        // If still too large, reduce quality iteratively
        while (processed.length > 200 * 1024 && quality > 50) {
          quality -= 10;
          processed = await sharp(buffer)
            .resize(256, 256, {
              fit: 'cover',
              position: 'center'
            })
            .png({ quality })
            .toBuffer();
        }

        const processedSizeKB = (processed.length / 1024).toFixed(2);
        logger.info(`[Admin] Processed avatar size: ${processedSizeKB} KB (quality: ${quality})`);

        if (processed.length > 200 * 1024) {
          logger.warn(`[Admin] Avatar still exceeds 200KB after optimization: ${processedSizeKB} KB`);
        }

        processedAvatarData = processed;

      } catch (error) {
        logger.error({ err: error }, '[Admin] Failed to process avatar');
        const errorResponse: ErrorResponse = {
          error: 'PROCESSING_ERROR',
          message: 'Failed to process avatar image. Ensure it is a valid image file.',
          timestamp: new Date().toISOString()
        };
        res.status(400).json(errorResponse);
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
        memoryEnabled: true,
        voiceEnabled: false,
        imageEnabled: false
      }
    });

    logger.info(`[Admin] Created personality: ${slug} (${personality.id})`);

    // Set default LLM config (find global default config)
    try {
      const defaultLlmConfig = await prisma.llmConfig.findFirst({
        where: {
          isGlobal: true,
          isDefault: true
        }
      });

      if (defaultLlmConfig) {
        await prisma.personalityDefaultConfig.create({
          data: {
            personalityId: personality.id,
            llmConfigId: defaultLlmConfig.id
          }
        });
        logger.info(`[Admin] Set default LLM config for ${slug}: ${defaultLlmConfig.name}`);
      } else {
        logger.warn('[Admin] No default global LLM config found, skipping default config assignment');
      }
    } catch (error) {
      // Non-critical error, log but don't fail the request
      logger.error({ err: error }, '[Admin] Failed to set default LLM config');
    }

    res.status(201).json({
      success: true,
      personality: {
        id: personality.id,
        name: personality.name,
        slug: personality.slug,
        displayName: personality.displayName,
        hasAvatar: !!processedAvatarData
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error({ err: error }, '[Admin] Failed to create personality');

    const errorResponse: ErrorResponse = {
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Failed to create personality',
      timestamp: new Date().toISOString()
    };

    res.status(500).json(errorResponse);
  }
});

/**
 * PATCH /admin/personality/:slug
 * Edit an existing AI personality
 */
router.patch('/personality/:slug', async (req: Request, res: Response) => {
  try {
    const ownerId = req.headers['x-owner-id'] as string;
    const config = getConfig();

    // Verify owner authorization
    if (!ownerId || !config.BOT_OWNER_ID || ownerId !== config.BOT_OWNER_ID) {
      const errorResponse: ErrorResponse = {
        error: 'UNAUTHORIZED',
        message: 'This endpoint is only available to the bot owner',
        timestamp: new Date().toISOString()
      };
      res.status(403).json(errorResponse);
      return;
    }

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
      avatarData
    } = req.body;

    // Check if personality exists
    const existing = await prisma.personality.findUnique({
      where: { slug }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        error: 'NOT_FOUND',
        message: `Personality with slug '${slug}' not found`,
        timestamp: new Date().toISOString()
      };
      res.status(404).json(errorResponse);
      return;
    }

    // Process avatar if provided
    let processedAvatarData: Buffer | undefined;
    if (avatarData) {
      try {
        logger.info(`[Admin] Processing avatar update for personality: ${slug}`);

        // Decode base64
        const buffer = Buffer.from(avatarData, 'base64');
        const originalSizeKB = (buffer.length / 1024).toFixed(2);
        logger.info(`[Admin] Original avatar size: ${originalSizeKB} KB`);

        // Resize and optimize image
        let quality = 90;
        let processed = await sharp(buffer)
          .resize(256, 256, {
            fit: 'cover',
            position: 'center'
          })
          .png({ quality })
          .toBuffer();

        // If still too large, reduce quality iteratively
        while (processed.length > 200 * 1024 && quality > 50) {
          quality -= 10;
          processed = await sharp(buffer)
            .resize(256, 256, {
              fit: 'cover',
              position: 'center'
            })
            .png({ quality })
            .toBuffer();
        }

        const processedSizeKB = (processed.length / 1024).toFixed(2);
        logger.info(`[Admin] Processed avatar size: ${processedSizeKB} KB (quality: ${quality})`);

        if (processed.length > 200 * 1024) {
          logger.warn(`[Admin] Avatar still exceeds 200KB after optimization: ${processedSizeKB} KB`);
        }

        processedAvatarData = processed;

      } catch (error) {
        logger.error({ err: error }, '[Admin] Failed to process avatar');
        const errorResponse: ErrorResponse = {
          error: 'PROCESSING_ERROR',
          message: 'Failed to process avatar image. Ensure it is a valid image file.',
          timestamp: new Date().toISOString()
        };
        res.status(400).json(errorResponse);
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
    if (personalityAppearance !== undefined) updateData.personalityAppearance = personalityAppearance;
    if (personalityLikes !== undefined) updateData.personalityLikes = personalityLikes;
    if (personalityDislikes !== undefined) updateData.personalityDislikes = personalityDislikes;
    if (conversationalGoals !== undefined) updateData.conversationalGoals = conversationalGoals;
    if (conversationalExamples !== undefined) updateData.conversationalExamples = conversationalExamples;
    if (customFields !== undefined) updateData.customFields = customFields;
    if (processedAvatarData !== undefined) updateData.avatarData = new Uint8Array(processedAvatarData);

    // Update personality in database
    const personality = await prisma.personality.update({
      where: { slug },
      data: updateData
    });

    logger.info(`[Admin] Updated personality: ${slug} (${personality.id})`);

    res.json({
      success: true,
      personality: {
        id: personality.id,
        name: personality.name,
        slug: personality.slug,
        displayName: personality.displayName,
        hasAvatar: !!personality.avatarData
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error({ err: error }, '[Admin] Failed to edit personality');

    const errorResponse: ErrorResponse = {
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Failed to edit personality',
      timestamp: new Date().toISOString()
    };

    res.status(500).json(errorResponse);
  }
});

export { router as adminRouter };
