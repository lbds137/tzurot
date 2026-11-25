/**
 * Persona Override Routes
 * - GET /api/user/persona/override - List persona overrides for personalities
 * - GET /api/user/persona/override/:personalitySlug - Get personality info for override modal
 * - PUT /api/user/persona/override/:personalitySlug - Set persona override for a personality
 * - DELETE /api/user/persona/override/:personalitySlug - Clear persona override
 * - POST /api/user/persona/override/by-id/:personalityId - Create persona + set as override
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
import { requireVisiblePersonality } from '../personality/helpers.js';

const logger = createLogger('user-persona-override');

/**
 * Broadcast a persona-cache eviction for this user. Swallowed on failure: the
 * write already committed, so the request must still succeed. Blast radius of a
 * failed broadcast is one resolver TTL of staleness in other processes.
 */
async function broadcastPersonaInvalidation(deps: RouteDeps, discordId: string): Promise<void> {
  if (deps.personaCacheInvalidation === undefined) {
    return;
  }
  try {
    await deps.personaCacheInvalidation.invalidateUserPersona(discordId);
  } catch (error) {
    logger.warn({ err: error }, 'Persona cache broadcast failed');
  }
}

/**
 * Validate slug and look up a personality the caller can VIEW. Sends error
 * response and returns null on failure: slug validation 400 first, then the
 * shared visibility gate (missing and invisible both 404 `Personality`).
 */
async function resolvePersonalityBySlug(
  prisma: PrismaClient,
  req: ProvisionedRequest,
  slug: string | undefined,
  res: Response
): Promise<{ id: string; name: string; displayName: string | null } | null> {
  if (slug === undefined) {
    sendError(res, ErrorResponses.validationError('Slug is required'));
    return null;
  }
  const slugValidation = validateSlug(slug);
  if (!slugValidation.valid) {
    sendError(res, slugValidation.error);
    return null;
  }

  const visible = await requireVisiblePersonality(prisma, req, res, { slug });
  if (visible === null) {
    return null;
  }

  // The visibility gate does not select `displayName`; fetch it in a second
  // narrow select rather than widening `VisiblePersonality` for every caller.
  const extra = await prisma.personality.findUnique({
    where: { id: visible.id },
    select: { displayName: true },
  });

  return { id: visible.id, name: visible.name, displayName: extra?.displayName ?? null };
}

/**
 * DELETE-only lookup for the clear-override flow: the same slug validation as
 * `resolvePersonalityBySlug` (an undefined or malformed slug answers 400; a
 * slug matching no personality answers 404 `Personality`), but the found personality carries NO
 * visibility gate. The override DELETE contract keeps held rows always
 * clearable: a caller who holds an override row can clear it even after the
 * personality has gone private, and `resolvePersonalityBySlug`'s gate would
 * 404 exactly that caller. Visibility is enforced on the no-row path instead
 * (see `handleClearPersonaOverride`).
 */
async function resolvePersonalityBySlugUngated(
  prisma: PrismaClient,
  slug: string | undefined,
  res: Response
): Promise<{ id: string; name: string; displayName: string | null } | null> {
  if (slug === undefined) {
    sendError(res, ErrorResponses.validationError('Slug is required'));
    return null;
  }
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
      req,
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

    const personality = await resolvePersonalityBySlug(prisma, req, personalitySlug, res);
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

    await broadcastPersonaInvalidation(deps, req.userId);

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

/**
 * Clear the caller's persona override for a personality.
 *
 * Visibility rule, asymmetric by design: a row the caller HOLDS is always
 * clearable — even after the personality has gone private, the holder of a
 * stale override must not be locked out of their own row. Without a row there
 * is nothing of the caller's to touch, but the `hadOverride: false` response
 * still carries personality data, so the no-row path runs the shared
 * visibility gate: an invisible personality answers 404 `Personality`,
 * indistinguishable from a missing slug.
 */
export const handleClearPersonaOverride = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const user = getOrCreateInternalUser(req);

    // Existence-only, ungated — NOT `resolvePersonalityBySlug`, whose gate
    // would 404 the row-holding caller this handler must keep serving.
    const personality = await resolvePersonalityBySlugUngated(
      prisma,
      getParam(req.params.personalitySlug),
      res
    );
    if (personality === null) {
      return;
    }

    const existing = await prisma.userPersonalityConfig.findUnique({
      where: { userId_personalityId: { userId: user.id, personalityId: personality.id } },
      select: { id: true, personaId: true },
    });

    const personalityResponse = {
      id: personality.id,
      name: personality.name,
      displayName: personality.displayName,
    };

    if (!existing) {
      // No row → the response carries personality data, so this is the gated
      // path: invisible personalities 404 `Personality` like a missing slug.
      if ((await requireVisiblePersonality(prisma, req, res, { id: personality.id })) === null) {
        return;
      }
      logger.info({ userId: user.id, personalityId: personality.id }, 'No override to clear');
      sendCustomSuccess(res, {
        success: true,
        personality: personalityResponse,
        hadOverride: false,
      });
      return;
    }

    // Held row → always clearable, whatever the personality's visibility is now.
    // Null the persona slice, then drop the row only if EVERY slice is now
    // null. (The prior check looked at llmConfigId alone, so it would have
    // wrongly deleted a row still carrying a vision/TTS/config override.)
    await prisma.userPersonalityConfig.update({
      where: { id: existing.id },
      data: { personaId: null },
    });
    await pruneEmptyPersonalityConfig(prisma, existing.id);

    logger.info({ userId: user.id, personalityId: personality.id }, 'Cleared persona override');

    // A row can exist for OTHER override slices (LLM/TTS/vision) with the
    // persona slice already null — nulling null changes nothing the resolver
    // reads, so only a real persona-slice clear broadcasts.
    if (existing.personaId !== null) {
      await broadcastPersonaInvalidation(deps, req.userId);
    }

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
    if (personalityId === undefined) {
      return sendError(res, ErrorResponses.validationError('personalityId is required'));
    }
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

    // Visibility gate first (missing and invisible both 404 `Personality`);
    // `displayName` for the response comes from a second narrow select rather
    // than widening `VisiblePersonality`.
    const visible = await requireVisiblePersonality(prisma, req, res, { id: personalityId });
    if (visible === null) {
      return;
    }
    const extra = await prisma.personality.findUnique({
      where: { id: visible.id },
      select: { displayName: true },
    });
    const personality = {
      id: visible.id,
      name: visible.name,
      displayName: extra?.displayName ?? null,
    };

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

    await broadcastPersonaInvalidation(deps, req.userId);

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
