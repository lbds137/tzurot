/**
 * Avatar Routes
 *
 * Serves personality avatars with filesystem caching and DB fallback.
 */

import { Router } from 'express';
import { resolve } from 'path';
import { access, writeFile } from 'fs/promises';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  CONTENT_TYPES,
  CACHE_CONTROL,
  type PrismaClient,
} from '@tzurot/common-types';
import { ErrorResponses } from '../../utils/errorResponses.js';

const logger = createLogger('api-gateway');

/**
 * Create avatar serving router
 * @param prisma - Prisma client for DB fallback
 */
export function createAvatarRouter(prisma: PrismaClient): Router {
  const router = Router();

  // Serve personality avatars with DB fallback
  // Avatars are primarily served from filesystem (/data/avatars)
  // If not found on filesystem, fall back to database and cache to filesystem
  router.get('/:slug.png', (req, res) => {
    void (async () => {
      const slug = req.params.slug;

      // Validate slug to prevent path traversal attacks
      if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
        const errorResponse = ErrorResponses.validationError('Invalid personality slug');
        res.status(StatusCodes.BAD_REQUEST).json(errorResponse);
        return;
      }

      // Construct and verify path stays within /data/avatars
      const avatarPath = resolve('/data/avatars', `${slug}.png`);
      if (!avatarPath.startsWith('/data/avatars/')) {
        const errorResponse = ErrorResponses.validationError('Invalid avatar path');
        res.status(StatusCodes.BAD_REQUEST).json(errorResponse);
        return;
      }

      try {
        // Try to serve from filesystem first
        await access(avatarPath);
        res.sendFile(avatarPath, {
          maxAge: '7d', // Cache for 7 days
          etag: true,
          lastModified: true,
        });
      } catch {
        // File not found on filesystem, check database
        try {
          const personality = await prisma.personality.findUnique({
            where: { slug },
            select: { avatarData: true },
          });

          if (!personality?.avatarData) {
            // Not in DB either, return 404
            const errorResponse = ErrorResponses.notFound(`Avatar for personality '${slug}'`);
            res.status(StatusCodes.NOT_FOUND).json(errorResponse);
            return;
          }

          // avatarData is already raw bytes (Buffer)
          const buffer = Buffer.from(personality.avatarData);

          // Cache to filesystem for future requests
          await writeFile(avatarPath, buffer);
          logger.info(`[Gateway] Cached avatar from DB to filesystem: ${slug}`);

          // Serve the image
          res.set('Content-Type', CONTENT_TYPES.IMAGE_PNG);
          res.set('Cache-Control', `max-age=${CACHE_CONTROL.AVATAR_MAX_AGE}`); // 7 days
          res.send(buffer);
        } catch (error) {
          logger.error({ err: error, slug }, '[Gateway] Error serving avatar');
          const errorResponse = ErrorResponses.internalError('Failed to retrieve avatar');
          res.status(StatusCodes.INTERNAL_SERVER_ERROR).json(errorResponse);
        }
      }
    })();
  });

  return router;
}
