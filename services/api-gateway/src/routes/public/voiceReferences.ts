/**
 * Voice Reference Routes
 *
 * Serves personality voice reference audio from database.
 * Unlike avatars, no filesystem caching — voice references are accessed infrequently
 * (only when registering voices with the voice-engine service).
 */

import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, CACHE_CONTROL, type PrismaClient } from '@tzurot/common-types';
import { ErrorResponses } from '../../utils/errorResponses.js';

const logger = createLogger('api-gateway');

/**
 * Create voice reference serving router
 * @param prisma - Prisma client for DB access
 */
export function createVoiceReferenceRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/:slug', (req, res) => {
    void (async () => {
      const { slug } = req.params;

      if (slug === undefined || slug.length === 0 || !/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) {
        const errorResponse = ErrorResponses.validationError('Invalid personality slug');
        res.status(StatusCodes.BAD_REQUEST).json(errorResponse);
        return;
      }

      try {
        const personality = await prisma.personality.findUnique({
          where: { slug },
          select: { voiceReferenceData: true, voiceReferenceType: true },
        });

        if (
          personality?.voiceReferenceData === null ||
          personality?.voiceReferenceData === undefined
        ) {
          const errorResponse = ErrorResponses.notFound(
            `Voice reference for personality '${slug}'`
          );
          res.status(StatusCodes.NOT_FOUND).json(errorResponse);
          return;
        }

        const buffer = Buffer.from(personality.voiceReferenceData);
        const contentType = personality.voiceReferenceType ?? 'audio/wav';

        res.set('Content-Type', contentType);
        res.set('Cache-Control', `max-age=${CACHE_CONTROL.AVATAR_MAX_AGE}`);
        res.send(buffer);
      } catch (error) {
        logger.error({ err: error, slug }, '[Gateway] Error serving voice reference');
        const errorResponse = ErrorResponses.internalError('Failed to retrieve voice reference');
        res.status(StatusCodes.INTERNAL_SERVER_ERROR).json(errorResponse);
      }
    })();
  });

  return router;
}
