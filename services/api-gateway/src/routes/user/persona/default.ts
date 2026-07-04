/**
 * Persona Default Routes
 * - PATCH /:id/default - Set persona as user's default
 */

import { type Response, type RequestHandler } from 'express';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { validateUuid } from '../../../utils/validators.js';
import { getParam } from '../../../utils/requestParams.js';
import type { ProvisionedRequest } from '../../../types.js';
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
