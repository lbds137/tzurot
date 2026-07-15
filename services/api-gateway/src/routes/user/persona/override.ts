/**
 * Persona Override Routes
 * - GET /override - List persona overrides for personalities
 * - GET /override/:personalitySlug - Get personality info for override modal
 * - PUT /override/:personalitySlug - Set persona override for a personality
 * - DELETE /override/:personalitySlug - Clear persona override
 * - POST /override/by-id/:personalityId - Create persona + set as override
 *     (single transaction; atomic)
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  PERSONA_SELECT,
  PersonaCreateSchema,
  SetPersonaOverrideSchema,
} from '@tzurot/common-types/schemas/api/persona';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  generatePersonaUuid,
  generateUserPersonalityConfigUuid,
} from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { isPrismaUniqueConstraintError } from '../../../utils/prismaErrors.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import { validateSlug, validateUuid } from '../../../utils/validators.js';
import { getParam } from '../../../utils/requestParams.js';
import type { ProvisionedRequest } from '../../../types.js';
import type { PersonaOverrideSummary } from './types.js';
import { getOrCreateInternalUser } from '../userHelpers.js';
import type { RouteDeps } from '../../routeDeps.js';
import { pruneEmptyPersonalityConfig } from '../pruneEmptyPersonalityConfig.js';

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

export const handleListPersonaOverrides = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const user = getOrCreateInternalUser(req);

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
  });
};

export const handleGetPersonaOverride = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
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
  });
};

export const handleSetPersonaOverride = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const personalitySlug = getParam(req.params.personalitySlug);

    // Validate request body with Zod
    const parseResult = SetPersonaOverrideSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { personaId: personaIdValue } = parseResult.data;

    const user = getOrCreateInternalUser(req);

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
      'Set persona override'
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
  });
};

export const handleClearPersonaOverride = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const user = getOrCreateInternalUser(req);

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
      select: { id: true },
    });

    const personalityResponse = {
      id: personality.id,
      name: personality.name,
      displayName: personality.displayName,
    };

    if (!existing) {
      logger.info({ userId: user.id, personalityId: personality.id }, 'No override to clear');
      sendCustomSuccess(res, {
        success: true,
        personality: personalityResponse,
        hadOverride: false,
      });
      return;
    }

    // Null the persona slice, then drop the row only if EVERY slice is now
    // null. (The prior check looked at llmConfigId alone, so it would have
    // wrongly deleted a row still carrying a vision/TTS/config override.)
    await prisma.userPersonalityConfig.update({
      where: { id: existing.id },
      data: { personaId: null },
    });
    await pruneEmptyPersonalityConfig(prisma, existing.id);

    logger.info({ userId: user.id, personalityId: personality.id }, 'Cleared persona override');
    sendCustomSuccess(res, { success: true, personality: personalityResponse, hadOverride: true });
  });
};

/**
 * Create a new persona AND set it as override for a personality, atomically.
 *
 * Path uses personality ID (not slug) because the create-for-override flow
 * has already resolved the personality via `GET /override/:slug` before
 * showing the modal — passing the UUID back avoids re-validating the slug.
 *
 * Atomicity is via `prisma.$transaction`: if the override-upsert fails
 * (concurrent write, constraint violation, etc.), the persona create rolls
 * back atomically — no orphaned persona row is left in the database.
 */
export const handleCreatePersonaOverride = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const personalityId = getParam(req.params.personalityId);
    const personalityIdValidation = validateUuid(personalityId, 'personalityId');
    if (!personalityIdValidation.valid) {
      return sendError(res, personalityIdValidation.error);
    }

    const parseResult = PersonaCreateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const { name, content, preferredName, description, pronouns } = parseResult.data;

    const user = getOrCreateInternalUser(req);

    const personality = await prisma.personality.findUnique({
      where: { id: personalityId },
      select: { id: true, name: true, displayName: true },
    });

    if (personality === null) {
      return sendError(res, ErrorResponses.notFound('Personality'));
    }

    // Deterministic persona UUID of (name, ownerId): a duplicate name for the
    // same owner trips P2002 on the persona insert. The whole transaction rolls
    // back (no orphaned persona or override), and we translate to a
    // NAME_COLLISION rather than an opaque 500 — same contract as the plain
    // persona-create path.
    let created;
    try {
      created = await prisma.$transaction(async tx => {
        const persona = await tx.persona.create({
          data: {
            id: generatePersonaUuid(name, user.id),
            name,
            preferredName: preferredName ?? null,
            description: description ?? null,
            content,
            pronouns: pronouns ?? null,
            ownerId: user.id,
          },
          select: PERSONA_SELECT,
        });

        await tx.userPersonalityConfig.upsert({
          where: { userId_personalityId: { userId: user.id, personalityId: personality.id } },
          create: {
            id: generateUserPersonalityConfigUuid(user.id, personality.id),
            userId: user.id,
            personalityId: personality.id,
            personaId: persona.id,
          },
          update: { personaId: persona.id },
        });

        return persona;
      });
    } catch (err) {
      if (isPrismaUniqueConstraintError(err)) {
        return sendError(
          res,
          ErrorResponses.nameCollision(`You already have a persona named "${name}".`)
        );
      }
      throw err;
    }

    logger.info(
      { userId: user.id, personalityId: personality.id, personaId: created.id },
      'Created persona and set as override'
    );

    sendCustomSuccess(
      res,
      {
        success: true,
        persona: {
          id: created.id,
          name: created.name,
          preferredName: created.preferredName,
          description: created.description,
          pronouns: created.pronouns,
          content: created.content,
        },
        personality: { name: personality.name, displayName: personality.displayName },
      },
      StatusCodes.CREATED
    );
  });
};
