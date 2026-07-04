/**
 * Voice Reference Routes
 *
 * Serves personality voice reference audio from database. Mounted behind
 * `requireServiceAuth()` in `index.ts` — sole consumer is ai-worker's
 * `voiceReferenceHelper` for BYOK cloning + self-hosted voice-engine
 * registration, both server-to-server within Railway's internal network.
 *
 * ACCESS POSTURE: service-auth-required. Slugs are predictable, so an
 * anonymous endpoint would let an attacker enumerate the voice-clone
 * library by brute-forcing slug names. No client-side consumer exists —
 * voice-engine fetches audio inline via TTS request bodies from ai-worker;
 * it never hits this route directly.
 *
 * CACHE NOTE: response sends `Cache-Control: no-store` because the sole
 * consumer is a server-to-server fetch with no HTTP cache layer between
 * ai-worker and api-gateway within Railway's internal network. The
 * user-visible latency bottleneck for voice reference updates is
 * ai-worker's `VoiceRegistrationService` 30-min in-memory positive cache,
 * which is unaffected by this header. Setting `no-store` also keeps the
 * response from being cached by any future caching proxy that might be
 * inserted into the path without `Vary: X-Service-Auth`.
 */

import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { VOICE_REFERENCE_LIMITS } from '@tzurot/common-types/constants/media';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
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
        let contentType: string;
        if (VOICE_REFERENCE_LIMITS.ALLOWED_TYPES.includes(storedType)) {
          contentType = storedType;
        } else {
          logger.warn({ slug, storedType }, 'Invalid stored MIME type, falling back to audio/wav');
          contentType = 'audio/wav';
        }

        res.set('Content-Type', contentType);
        res.set('Content-Length', String(buffer.length));
        res.set('Cache-Control', 'no-store');
        res.send(buffer);
      } catch (error) {
        logger.error({ err: error, slug }, 'Error serving voice reference');
        const errorResponse = ErrorResponses.internalError('Failed to retrieve voice reference');
        res.status(StatusCodes.INTERNAL_SERVER_ERROR).json(errorResponse);
      }
    })();
  });

  return router;
}
