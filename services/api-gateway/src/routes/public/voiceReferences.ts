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
 *
 * CACHE NOTE: max-age=3600 (1 hour) means updated voice references may be
 * stale for up to 1 hour in downstream caches. Unlike avatars (which use
 * timestamp-based cache-busting URLs), voice references are served from DB
 * with no filesystem cache layer. Acceptable for Phase 1 since the voice-engine
 * service isn't wired to fetch from this endpoint yet.
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
import { validateSlug } from '../../utils/validators.js';

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

      const slugValidation = validateSlug(slug);
      if (!slugValidation.valid) {
        res.status(StatusCodes.BAD_REQUEST).json(slugValidation.error);
        return;
      }

      try {
        const personality = await prisma.personality.findUnique({
          where: { slug },
          select: { voiceReferenceData: true, voiceReferenceType: true },
        });

        if (!personality?.voiceReferenceData) {
          const errorResponse = ErrorResponses.notFound('Voice reference');
          res.status(StatusCodes.NOT_FOUND).json(errorResponse);
          return;
        }

        // Prisma returns Bytes fields as Buffer — no wrapping needed
        const buffer = personality.voiceReferenceData;
        // Defense-in-depth: validate stored MIME type against allowed list
        const storedType = personality.voiceReferenceType ?? '';
        const contentType = VOICE_REFERENCE_LIMITS.ALLOWED_TYPES.includes(storedType)
          ? storedType
          : 'audio/wav';

        res.set('Content-Type', contentType);
        res.set('Content-Length', String(buffer.length));
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
