/**
 * POST /internal/v1/routing-context
 *
 * Hot-path routing read: resolves the per-(user, personality) routing facts a
 * Discord message needs BEFORE its AI job is dispatched — internal user UUID,
 * active persona (override → default cascade), persona display name, user
 * timezone, and the STM context-epoch. Provisions the user + default persona on
 * first contact (idempotent upsert keyed on discordId).
 *
 * Consolidated into one endpoint because the reads are sequentially dependent
 * (UUID → cascade → epoch); per-read routes would cost ~4 serialized HTTP hops
 * on the single most latency-sensitive path in the system. The persona cascade
 * runs here, where Prisma is legal, instead of being reimplemented in
 * bot-client. The orchestration lives in `resolveRoutingContext` (identity)
 * so it is unit-tested independently of HTTP.
 *
 * **Authentication**: `X-Service-Auth` enforcement happens upstream via the
 * global `requireServiceAuth()` on `/internal/*` in api-gateway's index.
 */

import { type Response, type RequestHandler } from 'express';
import {
  RoutingContextRequestSchema,
  type RoutingContextResponse,
} from '@tzurot/common-types/schemas/api/internal';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { PersonaResolver, resolveRoutingContext } from '@tzurot/identity';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { getOrCreateUserService } from '../../services/AuthMiddleware.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('internal-routing-context');

/** POST /api/internal/v1/routing-context — hot-path routing-fact resolution. */
export const handleRoutingContextCreate = (deps: RouteDeps): RequestHandler => {
  // Shared per-PrismaClient UserService (registry-wide cache + invalidation).
  // PersonaResolver is constructed once at mount (not per request) so its
  // in-memory cache stays warm across requests.
  const userService = getOrCreateUserService(deps.prisma);
  const personaResolver = new PersonaResolver(deps.prisma);

  return asyncHandler(async (req, res: Response) => {
    const parseResult = RoutingContextRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }

    const result = await resolveRoutingContext(
      { userService, personaResolver, prisma: deps.prisma },
      parseResult.data
    );

    if (result === null) {
      // Bot author. bot-client filters bots before dispatch, so this is a
      // defensive guard rather than an expected path.
      sendError(
        res,
        ErrorResponses.validationError('Cannot resolve routing context for a bot author')
      );
      return;
    }

    logger.debug(
      { userId: result.userId, personaId: result.personaId },
      'Routing context resolved'
    );
    sendCustomSuccess(res, result satisfies RoutingContextResponse);
  });
};
