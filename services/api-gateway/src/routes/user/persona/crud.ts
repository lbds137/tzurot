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
import { z } from 'zod';
import {
  createLogger,
  type PrismaClient,
  DISCORD_LIMITS,
  generatePersonaUuid,
  optionalString,
  nullableString,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { validateUuid } from '../../../utils/validators.js';
import { getParam } from '../../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../../types.js';
import type { PersonaSummary, PersonaDetails } from './types.js';
import { getOrCreateInternalUser } from './helpers.js';

const logger = createLogger('user-persona-crud');

// ===========================================
// ZOD SCHEMAS
// ===========================================

/**
 * Schema for creating a new persona.
 * - name: Required, non-empty string
 * - content: Required, non-empty string with max length
 * - preferredName, description, pronouns: Optional nullable strings
 */
const CreatePersonaBodySchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  content: z
    .string()
    .min(1, 'Content is required')
    .max(
      DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH,
      `Content must be ${DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH} characters or less`
    ),
  preferredName: nullableString(255),
  description: nullableString(500),
  pronouns: nullableString(100),
});

/**
 * Schema for updating a persona.
 * Uses empty-to-undefined/null transforms so clients can send "" to preserve or clear fields.
 * - name, content: Empty string → undefined (preserve existing value)
 * - preferredName, description, pronouns: Empty string → null (clear the value)
 */
const UpdatePersonaBodySchema = z.object({
  // Required DB fields: empty string → undefined (preserve existing value)
  name: optionalString(255),
  content: z.preprocess(
    val => {
      if (typeof val === 'string') {
        const trimmed = val.trim();
        return trimmed.length === 0 ? undefined : trimmed;
      }
      return val;
    },
    z
      .string()
      .max(
        DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH,
        `Content must be ${DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH} characters or less`
      )
      .optional()
  ),
  // Nullable DB fields: empty string → null (clear the value)
  preferredName: nullableString(255),
  description: nullableString(500),
  pronouns: nullableString(100),
});

// Type exports for tests
export type CreatePersonaBody = z.infer<typeof CreatePersonaBodySchema>;
export type UpdatePersonaBody = z.infer<typeof UpdatePersonaBodySchema>;

// ===========================================
// DATABASE CONSTANTS
// ===========================================

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

    // Validate request body with Zod
    const parseResult = CreatePersonaBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      const fieldPath = firstIssue.path.join('.');
      const message = fieldPath ? `${fieldPath}: ${firstIssue.message}` : firstIssue.message;
      return sendError(res, ErrorResponses.validationError(message));
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

    const idValidation = validateUuid(id, 'persona ID');
    if (!idValidation.valid) {
      return sendError(res, idValidation.error);
    }

    // Validate request body with Zod
    const parseResult = UpdatePersonaBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      const fieldPath = firstIssue.path.join('.');
      const message = fieldPath ? `${fieldPath}: ${firstIssue.message}` : firstIssue.message;
      return sendError(res, ErrorResponses.validationError(message));
    }

    const user = await getOrCreateInternalUser(prisma, discordUserId);

    const existing = await prisma.persona.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true },
    });

    if (existing === null) {
      return sendError(res, ErrorResponses.notFound('Persona'));
    }

    // Build update data from validated fields (only include defined values)
    const { name, content, preferredName, description, pronouns } = parseResult.data;
    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {updateData.name = name;}
    if (content !== undefined) {updateData.content = content;}
    if (preferredName !== undefined) {updateData.preferredName = preferredName;}
    if (description !== undefined) {updateData.description = description;}
    if (pronouns !== undefined) {updateData.pronouns = pronouns;}

    const persona = await prisma.persona.update({
      where: { id },
      data: updateData,
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

// --- Main Route Setup ---

export function addCrudRoutes(router: Router, prisma: PrismaClient): void {
  router.get('/', requireUserAuth(), asyncHandler(createListHandler(prisma)));
  router.get('/:id', requireUserAuth(), asyncHandler(createGetHandler(prisma)));
  router.post('/', requireUserAuth(), asyncHandler(createCreateHandler(prisma)));
  router.put('/:id', requireUserAuth(), asyncHandler(createUpdateHandler(prisma)));
  router.delete('/:id', requireUserAuth(), asyncHandler(createDeleteHandler(prisma)));
}
