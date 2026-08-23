/**
 * Persona Default Routes
 * - PATCH /api/user/persona/:id/default - Set persona as user's default
 */

import { type Response, type RequestHandler } from 'express';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { validateUuid } from '../../../utils/validators.js';
import { getParam } from '../../../utils/requestParams.js';
import type { ProvisionedRequest } from '../../../types.js';
import { getOrCreateUserService } from '../../../services/AuthMiddleware.js';
import { getOrCreateInternalUser } from '../userHelpers.js';
import type { RouteDeps } from '../../routeDeps.js';

const logger = createLogger('user-persona-default');

/** PATCH /api/user/persona/:id/default — promote a persona to user's default. */
export const handleSetPersonaDefault = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const id = getParam(req.params.id);

    const idValidation = validateUuid(id, 'persona ID');
    if (!idValidation.valid) {
      sendError(res, idValidation.error);
      return;
    }

    const user = getOrCreateInternalUser(req);

    const persona = await prisma.persona.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true, name: true, preferredName: true },
    });

    if (persona === null) {
      sendError(res, ErrorResponses.notFound('Persona'));
      return;
    }

    const alreadyDefault = user.defaultPersonaId === id;

    if (!alreadyDefault) {
      await prisma.user.update({
        where: { id: user.id },
        data: { defaultPersonaId: id },
      });

      // The `alreadyDefault` comparison above reads `defaultPersonaId` off the
      // request, which `requireProvisionedUser` stamps from the UserService
      // provisioning cache. That cache is not written by this update, so
      // without eviction the next set-default request re-reads the pre-update
      // value and short-circuits the write — the stale read GATES the write
      // rather than merely being stale. Pinned by the eviction-seam tests in
      // this route's suite.
      //   (1) Evict THIS process synchronously. `req.userId` is the Discord
      //       snowflake, which is the provisioning cache's key — `user.id` is
      //       the internal UUID and would silently evict nothing.
      getOrCreateUserService(prisma).invalidateUser(req.userId);
      //   (2) Broadcast so every OTHER process (ai-worker holds its own
      //       long-lived UserService) drops the mapping too.
      if (deps.userCacheInvalidation !== undefined) {
        try {
          await deps.userCacheInvalidation.invalidateUser(req.userId);
        } catch (error) {
          // Swallowed: THIS process was evicted synchronously above and the
          // write already committed, so the request must still succeed. Blast
          // radius of a failed broadcast: other processes' UserService caches
          // stay stale until the ~1h TTL. Bounded, self-healing.
          logger.warn({ err: error }, 'Default-persona user-cache broadcast failed');
        }
      }
      //   (3) The PERSONA resolver cache is a separate cache on a separate
      //       channel: PersonaResolver reads `user.defaultPersona` through its
      //       own per-(user, personality) TTLCache, so evicting the
      //       provisioning cache above does nothing for it. A default change
      //       is a persona-input write — broadcast on that channel too.
      if (deps.personaCacheInvalidation !== undefined) {
        try {
          await deps.personaCacheInvalidation.invalidateUserPersona(req.userId);
        } catch (error) {
          // Swallowed for the same reason as (2); blast radius is one
          // resolver TTL of staleness in subscribed processes.
          logger.warn({ err: error }, 'Default-persona persona-cache broadcast failed');
        }
      }
    }

    logger.info({ userId: user.id, personaId: id, alreadyDefault }, 'Set default persona');

    sendCustomSuccess(res, {
      success: true,
      persona: {
        id: persona.id,
        name: persona.name,
        preferredName: persona.preferredName,
      },
      alreadyDefault,
    });
  });
};
