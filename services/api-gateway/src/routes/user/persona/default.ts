/**
 * Persona Default Routes
 * - PATCH /:id/default - Set persona as user's default
 */

import { Router, type Response } from 'express';
import { createLogger, type PrismaClient } from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { validateUuid } from '../../../utils/validators.js';
import { getParam } from '../../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../../types.js';
import { getOrCreateInternalUser } from '../userHelpers.js';

const logger = createLogger('user-persona-default');

export function addDefaultRoutes(router: Router, prisma: PrismaClient): void {
  /**
   * PATCH /user/persona/:id/default
   * Set a persona as the user's default
   */
  router.patch(
    '/:id/default',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const id = getParam(req.params.id);

      const idValidation = validateUuid(id, 'persona ID');
      if (!idValidation.valid) {
        sendError(res, idValidation.error);
        return;
      }

      const user = await getOrCreateInternalUser(prisma, discordUserId);

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
      }

      logger.info(
        { userId: user.id, personaId: id, alreadyDefault },
        '[Persona] Set default persona'
      );

      sendCustomSuccess(res, {
        success: true,
        persona: {
          id: persona.id,
          name: persona.name,
          preferredName: persona.preferredName,
        },
        alreadyDefault,
      });
    })
  );
}
