/**
 * Avatar Routes
 *
 * Serves personality avatars with filesystem caching and DB fallback.
 */

import { Router } from 'express';
import { access, writeFile } from 'fs/promises';
import {
  getSafeAvatarPath,
  isValidSlug,
  extractSlugFromFilename,
  extractTimestampFromFilename,
  cleanupOldAvatarVersions,
} from '../../utils/avatarPaths.js';
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
  //
  // Supports two URL formats for cache-busting:
  // 1. Legacy: /avatars/{slug}.png
  // 2. Path-versioned: /avatars/{slug}-{timestamp}.png (Discord CDN cache-busting)
  //
  // Versioned files are stored WITH timestamps in the filename for direct URL-to-file mapping.
  // When a new version is fetched from DB, old versions are cleaned up asynchronously.
  router.get('/:filename', (req, res) => {
    void (async () => {
      const filename = req.params.filename;

      // Extract slug and timestamp from filename:
      // - "cold.png" -> slug="cold", timestamp=null
      // - "cold-1705827727111.png" -> slug="cold", timestamp=1705827727111
      const slug = extractSlugFromFilename(filename);
      const requestedTimestamp = extractTimestampFromFilename(filename);

      // Validate slug (prevents path traversal attacks)
      if (slug === null || !isValidSlug(slug)) {
        const errorResponse = ErrorResponses.validationError('Invalid personality slug');
        res.status(StatusCodes.BAD_REQUEST).json(errorResponse);
        return;
      }

      // Build path for the exact file being requested
      const avatarPath = getSafeAvatarPath(slug, requestedTimestamp ?? undefined);
      if (avatarPath === null) {
        const errorResponse = ErrorResponses.validationError('Invalid avatar path');
        res.status(StatusCodes.BAD_REQUEST).json(errorResponse);
        return;
      }

      try {
        // Try to serve the exact file from filesystem
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
            select: { avatarData: true, updatedAt: true },
          });

          if (!personality?.avatarData) {
            // Not in DB either, return 404
            const errorResponse = ErrorResponses.notFound(`Avatar for personality '${slug}'`);
            res.status(StatusCodes.NOT_FOUND).json(errorResponse);
            return;
          }

          // avatarData is already raw bytes (Buffer)
          const buffer = Buffer.from(personality.avatarData);
          const dbTimestamp = personality.updatedAt.getTime();

          // Build versioned path for caching
          const versionedPath = getSafeAvatarPath(slug, dbTimestamp);
          if (versionedPath !== null) {
            // Cache to filesystem with versioned filename
            await writeFile(versionedPath, buffer);
            logger.info({ slug, timestamp: dbTimestamp }, '[Gateway] Cached avatar from DB');

            // Cleanup old versions asynchronously (fire-and-forget)
            void cleanupOldAvatarVersions(slug, dbTimestamp);
          }

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
