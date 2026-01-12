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
import { getParam } from '../../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../../types.js';
import type { PersonaOverrideSummary, OverrideBody } from './types.js';
import { extractString, getOrCreateInternalUser } from './helpers.js';

const logger = createLogger('user-persona-override');

// --- Handler Factories ---

function createListHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const user = await getOrCreateInternalUser(prisma, discordUserId);

    const overrides = await prisma.userPersonalityConfig.findMany({
      where: { userId: user.id, personaId: { not: null } },
      select: {
        personalityId: true,
        personaId: true,
        personality: { select: { slug: true, name: true, displayName: true } },
        persona: { select: { name: true } },
      },
    });

    const response: PersonaOverrideSummary[] = overrides.flatMap(o => {
      if (o.persona === null || o.personaId === null) {return [];}
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
  };
}

function createGetHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const personalitySlug = getParam(req.params.personalitySlug);

    const slugValidation = validateSlug(personalitySlug);
    if (!slugValidation.valid) {
      return sendError(res, slugValidation.error);
    }

    const personality = await prisma.personality.findUnique({
      where: { slug: personalitySlug },
      select: { id: true, name: true, displayName: true },
    });

    if (personality === null) {
      return sendError(res, ErrorResponses.notFound('Personality'));
    }

    sendCustomSuccess(res, {
      personality: {
        id: personality.id,
        name: personality.name,
        displayName: personality.displayName,
      },
    });
  };
}

function createSetHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const personalitySlug = getParam(req.params.personalitySlug);
    const body = req.body as Partial<OverrideBody>;

    const slugValidation = validateSlug(personalitySlug);
    if (!slugValidation.valid) {
      return sendError(res, slugValidation.error);
    }

    const personaIdValue = extractString(body.personaId);
    if (personaIdValue === null) {
      return sendError(res, ErrorResponses.validationError('personaId is required'));
    }

    const personaIdValidation = validateUuid(personaIdValue, 'persona ID');
    if (!personaIdValidation.valid) {
      return sendError(res, personaIdValidation.error);
    }

    const user = await getOrCreateInternalUser(prisma, discordUserId);

    const persona = await prisma.persona.findFirst({
      where: { id: personaIdValue, ownerId: user.id },
      select: { id: true, name: true, preferredName: true },
    });

    if (persona === null) {
      return sendError(res, ErrorResponses.notFound('Persona'));
    }

    const personality = await prisma.personality.findUnique({
      where: { slug: personalitySlug },
      select: { id: true, name: true, displayName: true },
    });

    if (personality === null) {
      return sendError(res, ErrorResponses.notFound('Personality'));
    }

    await prisma.userPersonalityConfig.upsert({
      where: { userId_personalityId: { userId: user.id, personalityId: personality.id } },
      create: {
        id: generateUserPersonalityConfigUuid(user.id, personality.id),
        userId: user.id,
        personalityId: personality.id,
        personaId: personaIdValue,
      },
      update: { personaId: personaIdValue },
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
      persona: { id: persona.id, name: persona.name, preferredName: persona.preferredName },
    });
  };
}

function createClearHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const personalitySlug = getParam(req.params.personalitySlug);

    const slugValidation = validateSlug(personalitySlug);
    if (!slugValidation.valid) {
      return sendError(res, slugValidation.error);
    }

    const user = await getOrCreateInternalUser(prisma, discordUserId);

    const personality = await prisma.personality.findUnique({
      where: { slug: personalitySlug },
      select: { id: true, name: true, displayName: true },
    });

    if (personality === null) {
      return sendError(res, ErrorResponses.notFound('Personality'));
    }

    const existing = await prisma.userPersonalityConfig.findUnique({
      where: { userId_personalityId: { userId: user.id, personalityId: personality.id } },
      select: { id: true, llmConfigId: true },
    });

    const personalityResponse = {
      id: personality.id,
      name: personality.name,
      displayName: personality.displayName,
    };

    if (!existing) {
      logger.info({ userId: user.id, personalitySlug }, '[Persona] No override to clear');
      sendCustomSuccess(res, {
        success: true,
        personality: personalityResponse,
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
      await prisma.userPersonalityConfig.delete({ where: { id: existing.id } });
    }

    logger.info({ userId: user.id, personalitySlug }, '[Persona] Cleared persona override');
    sendCustomSuccess(res, { success: true, personality: personalityResponse, hadOverride: true });
  };
}

// --- Main Route Setup ---

export function addOverrideRoutes(router: Router, prisma: PrismaClient): void {
  router.get('/override', requireUserAuth(), asyncHandler(createListHandler(prisma)));
  router.get(
    '/override/:personalitySlug',
    requireUserAuth(),
    asyncHandler(createGetHandler(prisma))
  );
  router.put(
    '/override/:personalitySlug',
    requireUserAuth(),
    asyncHandler(createSetHandler(prisma))
  );
  router.delete(
    '/override/:personalitySlug',
    requireUserAuth(),
    asyncHandler(createClearHandler(prisma))
  );
}
