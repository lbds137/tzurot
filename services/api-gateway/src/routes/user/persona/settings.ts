/**
 * Persona Settings Routes
 * - PATCH /settings - Update persona settings (share-ltm)
 */

import { Router, type Response } from 'express';
import { createLogger, type PrismaClient, PersonaSettingsSchema } from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import type { AuthenticatedRequest } from '../../../types.js';
import { getOrCreateInternalUser } from '../userHelpers.js';

const logger = createLogger('user-persona-settings');

export function addSettingsRoutes(router: Router, prisma: PrismaClient): void {
  /**
   * PATCH /user/persona/settings
   * Update persona settings (currently just share-ltm)
   * Note: This affects the user's default persona
   */
  router.patch(
    '/settings',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;

      const parseResult = PersonaSettingsSchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendZodError(res, parseResult.error);
      }

      const { shareLtmAcrossPersonalities } = parseResult.data;

      const user = await getOrCreateInternalUser(prisma, discordUserId);

      if (user.defaultPersonaId === null) {
        sendError(
          res,
          ErrorResponses.validationError('No default persona set. Create a profile first.')
        );
        return;
      }

      const currentPersona = await prisma.persona.findUnique({
        where: { id: user.defaultPersonaId },
        select: { shareLtmAcrossPersonalities: true },
      });

      const unchanged = currentPersona?.shareLtmAcrossPersonalities === shareLtmAcrossPersonalities;

      if (!unchanged) {
        await prisma.persona.update({
          where: { id: user.defaultPersonaId },
          data: { shareLtmAcrossPersonalities },
        });
      }

      logger.info(
        { userId: user.id, shareLtmAcrossPersonalities, unchanged },
        '[Persona] Updated share-ltm setting'
      );

      sendCustomSuccess(res, {
        success: true,
        unchanged,
      });
    })
  );
}
