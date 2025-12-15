/**
 * Persona Override Routes
 * - GET /override - List persona overrides for personalities
 * - GET /override/:personalitySlug - Get personality info for override modal
 * - PUT /override/:personalitySlug - Set persona override for a personality
 * - DELETE /override/:personalitySlug - Clear persona override
 */

import { Router, type Response } from 'express';
import {
  createLogger,
  generateUserPersonalityConfigUuid,
  type PrismaClient,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { validateSlug, validateUuid } from '../../../utils/validators.js';
import type { AuthenticatedRequest } from '../../../types.js';
import type { PersonaOverrideSummary, OverrideBody } from './types.js';
import { extractString, getOrCreateInternalUser } from './helpers.js';

const logger = createLogger('user-persona-override');

export function addOverrideRoutes(router: Router, prisma: PrismaClient): void {
  /**
   * GET /user/persona/override
   * List all persona overrides for specific personalities
   */
  router.get(
    '/override',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const user = await getOrCreateInternalUser(prisma, discordUserId);

      const overrides = await prisma.userPersonalityConfig.findMany({
        where: {
          userId: user.id,
          personaId: { not: null },
        },
        select: {
          personalityId: true,
          personaId: true,
          personality: {
            select: { slug: true, name: true, displayName: true },
          },
          persona: {
            select: { name: true },
          },
        },
      });

      const response: PersonaOverrideSummary[] = overrides.flatMap(o => {
        if (o.persona === null || o.personaId === null) {
          return [];
        }
        return [
          {
            personalityId: o.personalityId,
            personalitySlug: o.personality.slug,
            personalityName: o.personality.displayName ?? o.personality.name,
            personaId: o.personaId,
            personaName: o.persona.name,
          },
        ];
      });

      sendCustomSuccess(res, { overrides: response });
    })
  );

  /**
   * GET /user/persona/override/:personalitySlug
   * Get personality info for override modal (when creating new persona for override)
   */
  router.get(
    '/override/:personalitySlug',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const { personalitySlug } = req.params;

      const slugValidation = validateSlug(personalitySlug);
      if (!slugValidation.valid) {
        sendError(res, slugValidation.error);
        return;
      }

      const personality = await prisma.personality.findUnique({
        where: { slug: personalitySlug },
        select: { id: true, name: true, displayName: true },
      });

      if (personality === null) {
        sendError(res, ErrorResponses.notFound('Personality'));
        return;
      }

      sendCustomSuccess(res, {
        personality: {
          id: personality.id,
          name: personality.name,
          displayName: personality.displayName,
        },
      });
    })
  );

  /**
   * PUT /user/persona/override/:personalitySlug
   * Set a persona override for a specific personality
   */
  router.put(
    '/override/:personalitySlug',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const { personalitySlug } = req.params;
      const body = req.body as Partial<OverrideBody>;

      const slugValidation = validateSlug(personalitySlug);
      if (!slugValidation.valid) {
        sendError(res, slugValidation.error);
        return;
      }

      const personaIdValue = extractString(body.personaId);
      if (personaIdValue === null) {
        sendError(res, ErrorResponses.validationError('personaId is required'));
        return;
      }

      const personaIdValidation = validateUuid(personaIdValue, 'persona ID');
      if (!personaIdValidation.valid) {
        sendError(res, personaIdValidation.error);
        return;
      }

      const user = await getOrCreateInternalUser(prisma, discordUserId);

      const persona = await prisma.persona.findFirst({
        where: { id: personaIdValue, ownerId: user.id },
        select: { id: true, name: true, preferredName: true },
      });

      if (persona === null) {
        sendError(res, ErrorResponses.notFound('Persona'));
        return;
      }

      const personality = await prisma.personality.findUnique({
        where: { slug: personalitySlug },
        select: { id: true, name: true, displayName: true },
      });

      if (personality === null) {
        sendError(res, ErrorResponses.notFound('Personality'));
        return;
      }

      await prisma.userPersonalityConfig.upsert({
        where: {
          userId_personalityId: {
            userId: user.id,
            personalityId: personality.id,
          },
        },
        create: {
          id: generateUserPersonalityConfigUuid(user.id, personality.id),
          userId: user.id,
          personalityId: personality.id,
          personaId: personaIdValue,
        },
        update: {
          personaId: personaIdValue,
        },
      });

      logger.info(
        { userId: user.id, personalitySlug, personaId: personaIdValue },
        '[Persona] Set persona override'
      );

      sendCustomSuccess(res, {
        success: true,
        personality: {
          id: personality.id,
          name: personality.name,
          displayName: personality.displayName,
        },
        persona: {
          id: persona.id,
          name: persona.name,
          preferredName: persona.preferredName,
        },
      });
    })
  );

  /**
   * DELETE /user/persona/override/:personalitySlug
   * Clear persona override for a specific personality
   */
  router.delete(
    '/override/:personalitySlug',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const { personalitySlug } = req.params;

      const slugValidation = validateSlug(personalitySlug);
      if (!slugValidation.valid) {
        sendError(res, slugValidation.error);
        return;
      }

      const user = await getOrCreateInternalUser(prisma, discordUserId);

      const personality = await prisma.personality.findUnique({
        where: { slug: personalitySlug },
        select: { id: true, name: true, displayName: true },
      });

      if (personality === null) {
        sendError(res, ErrorResponses.notFound('Personality'));
        return;
      }

      const existing = await prisma.userPersonalityConfig.findUnique({
        where: {
          userId_personalityId: {
            userId: user.id,
            personalityId: personality.id,
          },
        },
        select: { id: true, llmConfigId: true },
      });

      if (!existing) {
        logger.info({ userId: user.id, personalitySlug }, '[Persona] No override to clear');
        sendCustomSuccess(res, {
          success: true,
          personality: {
            id: personality.id,
            name: personality.name,
            displayName: personality.displayName,
          },
          hadOverride: false,
        });
        return;
      }

      if (existing.llmConfigId !== null) {
        await prisma.userPersonalityConfig.update({
          where: { id: existing.id },
          data: { personaId: null },
        });
      } else {
        await prisma.userPersonalityConfig.delete({
          where: { id: existing.id },
        });
      }

      logger.info({ userId: user.id, personalitySlug }, '[Persona] Cleared persona override');

      sendCustomSuccess(res, {
        success: true,
        personality: {
          id: personality.id,
          name: personality.name,
          displayName: personality.displayName,
        },
        hadOverride: true,
      });
    })
  );
}
