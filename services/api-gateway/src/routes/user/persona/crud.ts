/**
 * Persona CRUD Routes
 * - GET / - List user's personas
 * - GET /:id - Get a specific persona
 * - POST / - Create a new persona
 * - PUT /:id - Update a persona
 * - DELETE /:id - Delete a persona
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  generatePersonaUuid,
  PersonaCreateSchema,
  PersonaUpdateSchema,
  PERSONA_SELECT,
  type PersonaSummary,
  type PersonaDetails,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import { validateUuid } from '../../../utils/validators.js';
import { getParam } from '../../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../../types.js';
import { getOrCreateInternalUser } from '../userHelpers.js';

const logger = createLogger('user-persona-crud');

interface PersonaFromDb {
  id: string;
  name: string;
  preferredName: string | null;
  description: string | null;
  content: string;
  pronouns: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toPersonaDetails(p: PersonaFromDb, isDefault: boolean): PersonaDetails {
  return {
    id: p.id,
    name: p.name,
    preferredName: p.preferredName,
    description: p.description,
    content: p.content,
    pronouns: p.pronouns,
    isDefault,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/**
 * Validate UUID, look up user, and verify persona ownership.
 * Sends error response and returns null on failure.
 */
async function resolveOwnedPersona(
  prisma: PrismaClient,
  discordUserId: string,
  id: string | undefined,
  res: Response
): Promise<{
  user: { id: string; defaultPersonaId: string | null };
  persona: { id: string };
} | null> {
  const idValidation = validateUuid(id, 'persona ID');
  if (!idValidation.valid) {
    sendError(res, idValidation.error);
    return null;
  }

  const user = await getOrCreateInternalUser(prisma, discordUserId);

  const persona = await prisma.persona.findFirst({
    where: { id, ownerId: user.id },
    select: { id: true },
  });

  if (persona === null) {
    sendError(res, ErrorResponses.notFound('Persona'));
    return null;
  }

  return { user, persona };
}

// --- Handler Factories ---

function createListHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const user = await getOrCreateInternalUser(prisma, discordUserId);

    const personas = await prisma.persona.findMany({
      where: { ownerId: user.id },
      select: PERSONA_SELECT,
      orderBy: { name: 'asc' },
      take: 50,
    });

    const response: PersonaSummary[] = personas.map(p => ({
      ...toPersonaDetails(p, p.id === user.defaultPersonaId),
    }));

    sendCustomSuccess(res, { personas: response });
  };
}

function createGetHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const id = getParam(req.params.id);

    const idValidation = validateUuid(id, 'persona ID');
    if (!idValidation.valid) {
      return sendError(res, idValidation.error);
    }

    const user = await getOrCreateInternalUser(prisma, discordUserId);

    const persona = await prisma.persona.findFirst({
      where: { id, ownerId: user.id },
      select: PERSONA_SELECT,
    });

    if (persona === null) {
      return sendError(res, ErrorResponses.notFound('Persona'));
    }

    sendCustomSuccess(res, {
      persona: toPersonaDetails(persona, persona.id === user.defaultPersonaId),
    });
  };
}

function createCreateHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    // Validate request body with Zod
    const parseResult = PersonaCreateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { name, content, preferredName, description, pronouns } = parseResult.data;

    const user = await getOrCreateInternalUser(prisma, discordUserId);

    const persona = await prisma.persona.create({
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

    const isFirstPersona = user.defaultPersonaId === null;
    if (isFirstPersona) {
      await prisma.user.update({
        where: { id: user.id },
        data: { defaultPersonaId: persona.id },
      });
    }

    logger.info({ userId: user.id, personaId: persona.id }, '[Persona] Created new persona');

    sendCustomSuccess(
      res,
      {
        success: true,
        persona: toPersonaDetails(persona, isFirstPersona),
        setAsDefault: isFirstPersona,
      },
      StatusCodes.CREATED
    );
  };
}

function createUpdateHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const id = getParam(req.params.id);

    const resolved = await resolveOwnedPersona(prisma, discordUserId, id, res);
    if (resolved === null) {
      return;
    }
    const { user, persona: ownedPersona } = resolved;

    // Validate request body with Zod
    const parseResult = PersonaUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    // Build update data from validated fields (only include defined values)
    const { name, content, preferredName, description, pronouns } = parseResult.data;
    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      updateData.name = name;
    }
    if (content !== undefined) {
      updateData.content = content;
    }
    if (preferredName !== undefined) {
      updateData.preferredName = preferredName;
    }
    if (description !== undefined) {
      updateData.description = description;
    }
    if (pronouns !== undefined) {
      updateData.pronouns = pronouns;
    }

    const persona = await prisma.persona.update({
      where: { id: ownedPersona.id },
      data: updateData,
      select: PERSONA_SELECT,
    });

    logger.info({ userId: user.id, personaId: ownedPersona.id }, '[Persona] Updated persona');

    sendCustomSuccess(res, {
      success: true,
      persona: toPersonaDetails(persona, persona.id === user.defaultPersonaId),
    });
  };
}

function createDeleteHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const id = getParam(req.params.id);

    const resolved = await resolveOwnedPersona(prisma, discordUserId, id, res);
    if (resolved === null) {
      return;
    }
    const { user, persona } = resolved;

    if (user.defaultPersonaId === persona.id) {
      return sendError(
        res,
        ErrorResponses.validationError(
          'Cannot delete your default persona. Set a different default first.'
        )
      );
    }

    await prisma.persona.delete({ where: { id: persona.id } });
    logger.info({ userId: user.id, personaId: persona.id }, '[Persona] Deleted persona');

    sendCustomSuccess(res, { message: 'Persona deleted' });
  };
}

// --- Main Route Setup ---

export function addCrudRoutes(router: Router, prisma: PrismaClient): void {
  router.get('/', requireUserAuth(), asyncHandler(createListHandler(prisma)));
  router.get('/:id', requireUserAuth(), asyncHandler(createGetHandler(prisma)));
  router.post('/', requireUserAuth(), asyncHandler(createCreateHandler(prisma)));
  router.put('/:id', requireUserAuth(), asyncHandler(createUpdateHandler(prisma)));
  router.delete('/:id', requireUserAuth(), asyncHandler(createDeleteHandler(prisma)));
}
