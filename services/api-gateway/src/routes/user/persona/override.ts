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
  SetPersonaOverrideSchema,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import { validateSlug } from '../../../utils/validators.js';
import { getParam } from '../../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../../types.js';
import type { PersonaOverrideSummary } from './types.js';
import { getOrCreateInternalUser } from '../userHelpers.js';

const logger = createLogger('user-persona-override');

/**
 * Validate slug and look up personality. Sends error response and returns null on failure.
 */
async function resolvePersonalityBySlug(
  prisma: PrismaClient,
  slug: string | undefined,
  res: Response
): Promise<{ id: string; name: string; displayName: string | null } | null> {
  const slugValidation = validateSlug(slug);
  if (!slugValidation.valid) {
    sendError(res, slugValidation.error);
    return null;
  }

  const personality = await prisma.personality.findUnique({
    where: { slug },
    select: { id: true, name: true, displayName: true },
  });

  if (personality === null) {
    sendError(res, ErrorResponses.notFound('Personality'));
    return null;
  }

  return personality;
}

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
      take: 100,
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
  };
}

function createGetHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const personality = await resolvePersonalityBySlug(
      prisma,
      getParam(req.params.personalitySlug),
      res
    );
    if (personality === null) {
      return;
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

    // Validate request body with Zod
    const parseResult = SetPersonaOverrideSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { personaId: personaIdValue } = parseResult.data;

    const user = await getOrCreateInternalUser(prisma, discordUserId);

    const persona = await prisma.persona.findFirst({
      where: { id: personaIdValue, ownerId: user.id },
      select: { id: true, name: true, preferredName: true },
    });

    if (persona === null) {
      return sendError(res, ErrorResponses.notFound('Persona'));
    }

    const personality = await resolvePersonalityBySlug(prisma, personalitySlug, res);
    if (personality === null) {
      return;
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

    const user = await getOrCreateInternalUser(prisma, discordUserId);

    const personality = await resolvePersonalityBySlug(
      prisma,
      getParam(req.params.personalitySlug),
      res
    );
    if (personality === null) {
      return;
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
      logger.info(
        { userId: user.id, personalityId: personality.id },
        '[Persona] No override to clear'
      );
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

    logger.info(
      { userId: user.id, personalityId: personality.id },
      '[Persona] Cleared persona override'
    );
    sendCustomSuccess(res, { success: true, personality: personalityResponse, hadOverride: true });
  };
}

// --- Main Route Setup ---

const OVERRIDE_BY_SLUG = '/override/:personalitySlug';

export function addOverrideRoutes(router: Router, prisma: PrismaClient): void {
  router.get('/override', requireUserAuth(), asyncHandler(createListHandler(prisma)));
  router.get(OVERRIDE_BY_SLUG, requireUserAuth(), asyncHandler(createGetHandler(prisma)));
  router.put(OVERRIDE_BY_SLUG, requireUserAuth(), asyncHandler(createSetHandler(prisma)));
  router.delete(OVERRIDE_BY_SLUG, requireUserAuth(), asyncHandler(createClearHandler(prisma)));
}
