/**
 * Voice Reference Routes
 *
 * Serves personality voice reference audio from database.
 * Unlike avatars, no filesystem caching — voice references are accessed infrequently
 * (only when registering voices with the voice-engine service).
 *
 * ACCESS DECISION: This endpoint is intentionally unauthenticated. Voice
 * references are treated as semi-public data (like avatars) — anyone with the
 * personality slug can retrieve them. The primary consumer is the voice-engine
 * service which fetches reference audio for voice cloning without user auth
 * context. If voice references become sensitive, add a shared service secret.
 */

import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  CACHE_CONTROL,
  VOICE_REFERENCE_LIMITS,
  type PrismaClient,
} from '@tzurot/common-types';
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
        // Defense-in-depth: validate stored MIME type against allowed list
        const storedType = personality.voiceReferenceType ?? '';
        const contentType = VOICE_REFERENCE_LIMITS.ALLOWED_TYPES.includes(storedType)
          ? storedType
          : 'audio/wav';

        res.set('Content-Type', contentType);
        res.set('Cache-Control', `max-age=${CACHE_CONTROL.VOICE_REFERENCE_MAX_AGE}`);
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
