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
  DISCORD_LIMITS,
  generatePersonaUuid,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { validateUuid } from '../../../utils/validators.js';
import { getParam } from '../../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../../types.js';
import type {
  PersonaSummary,
  PersonaDetails,
  CreatePersonaBody,
  UpdatePersonaBody,
} from './types.js';
import { extractString, getOrCreateInternalUser } from './helpers.js';

const logger = createLogger('user-persona-crud');

const PERSONA_SELECT = {
  id: true,
  name: true,
  preferredName: true,
  description: true,
  content: true,
  pronouns: true,
  shareLtmAcrossPersonalities: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface PersonaFromDb {
  id: string;
  name: string;
  preferredName: string | null;
  description: string | null;
  content: string;
  pronouns: string | null;
  shareLtmAcrossPersonalities: boolean;
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
    shareLtmAcrossPersonalities: p.shareLtmAcrossPersonalities,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
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
    const body = req.body as Partial<CreatePersonaBody>;

    const nameValue = extractString(body.name);
    if (nameValue === null) {
      return sendError(res, ErrorResponses.validationError('Name is required'));
    }

    const contentValue = extractString(body.content);
    if (contentValue === null) {
      return sendError(res, ErrorResponses.validationError('Content is required'));
    }

    if (contentValue.length > DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH) {
      return sendError(
        res,
        ErrorResponses.validationError(
          `Content must be ${DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH} characters or less`
        )
      );
    }

    const user = await getOrCreateInternalUser(prisma, discordUserId);

    const persona = await prisma.persona.create({
      data: {
        id: generatePersonaUuid(nameValue, user.id),
        name: nameValue,
        preferredName: extractString(body.preferredName),
        description: extractString(body.description),
        content: contentValue,
        pronouns: extractString(body.pronouns),
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
    const body = req.body as Partial<UpdatePersonaBody>;

    const idValidation = validateUuid(id, 'persona ID');
    if (!idValidation.valid) {
      return sendError(res, idValidation.error);
    }

    const user = await getOrCreateInternalUser(prisma, discordUserId);

    const existing = await prisma.persona.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true },
    });

    if (existing === null) {
      return sendError(res, ErrorResponses.notFound('Persona'));
    }

    const updateResult = buildUpdateData(body);
    if ('error' in updateResult) {
      return sendError(res, updateResult.error);
    }

    const persona = await prisma.persona.update({
      where: { id },
      data: updateResult,
      select: PERSONA_SELECT,
    });

    logger.info({ userId: user.id, personaId: id }, '[Persona] Updated persona');

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

    const idValidation = validateUuid(id, 'persona ID');
    if (!idValidation.valid) {
      return sendError(res, idValidation.error);
    }

    const user = await getOrCreateInternalUser(prisma, discordUserId);

    const existing = await prisma.persona.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true },
    });

    if (existing === null) {
      return sendError(res, ErrorResponses.notFound('Persona'));
    }

    if (user.defaultPersonaId === id) {
      return sendError(
        res,
        ErrorResponses.validationError(
          'Cannot delete your default persona. Set a different default first.'
        )
      );
    }

    await prisma.persona.delete({ where: { id } });
    logger.info({ userId: user.id, personaId: id }, '[Persona] Deleted persona');

    sendCustomSuccess(res, { message: 'Persona deleted' });
  };
}

// --- Helper Functions ---

interface PersonaUpdateData {
  name?: string;
  preferredName?: string | null;
  description?: string | null;
  content?: string;
  pronouns?: string | null;
}

function buildUpdateData(
  body: Partial<UpdatePersonaBody>
): PersonaUpdateData | { error: ReturnType<typeof ErrorResponses.validationError> } {
  const updateData: PersonaUpdateData = {};

  if (body.name !== undefined) {
    const nameValue = extractString(body.name);
    if (nameValue === null) {
      return { error: ErrorResponses.validationError('Name cannot be empty') };
    }
    updateData.name = nameValue;
  }

  // Content is required and cannot be set to null/empty, so only update if a valid string is provided.
  // If body.content is null or undefined, preserve the existing value (don't include in update).
  if (body.content !== undefined && body.content !== null) {
    const contentValue = extractString(body.content);
    if (contentValue === null) {
      return { error: ErrorResponses.validationError('Content cannot be empty') };
    }
    if (contentValue.length > DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH) {
      return {
        error: ErrorResponses.validationError(
          `Content must be ${DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH} characters or less`
        ),
      };
    }
    updateData.content = contentValue;
  }

  if (body.preferredName !== undefined) {
    updateData.preferredName = extractString(body.preferredName);
  }
  if (body.description !== undefined) {
    updateData.description = extractString(body.description);
  }
  if (body.pronouns !== undefined) {
    updateData.pronouns = extractString(body.pronouns);
  }

  return updateData;
}

// --- Main Route Setup ---

export function addCrudRoutes(router: Router, prisma: PrismaClient): void {
  router.get('/', requireUserAuth(), asyncHandler(createListHandler(prisma)));
  router.get('/:id', requireUserAuth(), asyncHandler(createGetHandler(prisma)));
  router.post('/', requireUserAuth(), asyncHandler(createCreateHandler(prisma)));
  router.put('/:id', requireUserAuth(), asyncHandler(createUpdateHandler(prisma)));
  router.delete('/:id', requireUserAuth(), asyncHandler(createDeleteHandler(prisma)));
}
