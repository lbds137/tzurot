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
import { createLogger, type PrismaClient, DISCORD_LIMITS, generatePersonaUuid } from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { validateUuid } from '../../../utils/validators.js';
import type { AuthenticatedRequest } from '../../../types.js';
import type {
  PersonaSummary,
  PersonaDetails,
  CreatePersonaBody,
  UpdatePersonaBody,
} from './types.js';
import { extractString, getOrCreateInternalUser } from './helpers.js';

const logger = createLogger('user-persona-crud');

export function addCrudRoutes(router: Router, prisma: PrismaClient): void {
  /**
   * GET /user/persona
   * List all personas owned by the user
   */
  router.get(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const user = await getOrCreateInternalUser(prisma, discordUserId);

      const personas = await prisma.persona.findMany({
        where: { ownerId: user.id },
        select: {
          id: true,
          name: true,
          preferredName: true,
          description: true,
          pronouns: true,
          content: true,
          shareLtmAcrossPersonalities: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { name: 'asc' },
      });

      const response: PersonaSummary[] = personas.map(p => ({
        id: p.id,
        name: p.name,
        preferredName: p.preferredName,
        description: p.description,
        pronouns: p.pronouns,
        content: p.content,
        isDefault: p.id === user.defaultPersonaId,
        shareLtmAcrossPersonalities: p.shareLtmAcrossPersonalities,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }));

      sendCustomSuccess(res, { personas: response });
    })
  );

  /**
   * GET /user/persona/:id
   * Get a specific persona by ID
   */
  router.get(
    '/:id',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const { id } = req.params;

      const idValidation = validateUuid(id, 'persona ID');
      if (!idValidation.valid) {
        sendError(res, idValidation.error);
        return;
      }

      const user = await getOrCreateInternalUser(prisma, discordUserId);

      const persona = await prisma.persona.findFirst({
        where: { id, ownerId: user.id },
        select: {
          id: true,
          name: true,
          preferredName: true,
          description: true,
          content: true,
          pronouns: true,
          shareLtmAcrossPersonalities: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (persona === null) {
        sendError(res, ErrorResponses.notFound('Persona'));
        return;
      }

      const response: PersonaDetails = {
        id: persona.id,
        name: persona.name,
        preferredName: persona.preferredName,
        description: persona.description,
        content: persona.content,
        pronouns: persona.pronouns,
        isDefault: persona.id === user.defaultPersonaId,
        shareLtmAcrossPersonalities: persona.shareLtmAcrossPersonalities,
        createdAt: persona.createdAt.toISOString(),
        updatedAt: persona.updatedAt.toISOString(),
      };

      sendCustomSuccess(res, { persona: response });
    })
  );

  /**
   * POST /user/persona
   * Create a new persona
   */
  router.post(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const body = req.body as Partial<CreatePersonaBody>;

      const nameValue = extractString(body.name);
      if (nameValue === null) {
        sendError(res, ErrorResponses.validationError('Name is required'));
        return;
      }

      const contentValue = extractString(body.content);
      if (contentValue === null) {
        sendError(res, ErrorResponses.validationError('Content is required'));
        return;
      }

      if (contentValue.length > DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH) {
        sendError(
          res,
          ErrorResponses.validationError(
            `Content must be ${DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH} characters or less`
          )
        );
        return;
      }

      const preferredNameValue = extractString(body.preferredName);
      const descriptionValue = extractString(body.description);
      const pronounsValue = extractString(body.pronouns);

      const user = await getOrCreateInternalUser(prisma, discordUserId);

      const persona = await prisma.persona.create({
        data: {
          id: generatePersonaUuid(nameValue, user.id),
          name: nameValue,
          preferredName: preferredNameValue,
          description: descriptionValue,
          content: contentValue,
          pronouns: pronounsValue,
          ownerId: user.id,
        },
        select: {
          id: true,
          name: true,
          preferredName: true,
          description: true,
          content: true,
          pronouns: true,
          shareLtmAcrossPersonalities: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const isFirstPersona = user.defaultPersonaId === null;
      if (isFirstPersona) {
        await prisma.user.update({
          where: { id: user.id },
          data: { defaultPersonaId: persona.id },
        });
      }

      logger.info({ userId: user.id, personaId: persona.id }, '[Persona] Created new persona');

      const response: PersonaDetails = {
        id: persona.id,
        name: persona.name,
        preferredName: persona.preferredName,
        description: persona.description,
        content: persona.content,
        pronouns: persona.pronouns,
        isDefault: isFirstPersona,
        shareLtmAcrossPersonalities: persona.shareLtmAcrossPersonalities,
        createdAt: persona.createdAt.toISOString(),
        updatedAt: persona.updatedAt.toISOString(),
      };

      sendCustomSuccess(
        res,
        { success: true, persona: response, setAsDefault: isFirstPersona },
        StatusCodes.CREATED
      );
    })
  );

  /**
   * PUT /user/persona/:id
   * Update an existing persona
   */
  router.put(
    '/:id',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const { id } = req.params;
      const body = req.body as Partial<UpdatePersonaBody>;

      const idValidation = validateUuid(id, 'persona ID');
      if (!idValidation.valid) {
        sendError(res, idValidation.error);
        return;
      }

      const user = await getOrCreateInternalUser(prisma, discordUserId);

      const existing = await prisma.persona.findFirst({
        where: { id, ownerId: user.id },
        select: { id: true },
      });

      if (existing === null) {
        sendError(res, ErrorResponses.notFound('Persona'));
        return;
      }

      const updateData: {
        name?: string;
        preferredName?: string | null;
        description?: string | null;
        content?: string;
        pronouns?: string | null;
      } = {};

      if (body.name !== undefined) {
        const nameValue = extractString(body.name);
        if (nameValue === null) {
          sendError(res, ErrorResponses.validationError('Name cannot be empty'));
          return;
        }
        updateData.name = nameValue;
      }

      if (body.content !== undefined) {
        const contentValue = extractString(body.content);
        if (contentValue === null) {
          sendError(res, ErrorResponses.validationError('Content cannot be empty'));
          return;
        }
        if (contentValue.length > DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH) {
          sendError(
            res,
            ErrorResponses.validationError(
              `Content must be ${DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH} characters or less`
            )
          );
          return;
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

      const persona = await prisma.persona.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          name: true,
          preferredName: true,
          description: true,
          content: true,
          pronouns: true,
          shareLtmAcrossPersonalities: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      logger.info({ userId: user.id, personaId: id }, '[Persona] Updated persona');

      const response: PersonaDetails = {
        id: persona.id,
        name: persona.name,
        preferredName: persona.preferredName,
        description: persona.description,
        content: persona.content,
        pronouns: persona.pronouns,
        isDefault: persona.id === user.defaultPersonaId,
        shareLtmAcrossPersonalities: persona.shareLtmAcrossPersonalities,
        createdAt: persona.createdAt.toISOString(),
        updatedAt: persona.updatedAt.toISOString(),
      };

      sendCustomSuccess(res, { success: true, persona: response });
    })
  );

  /**
   * DELETE /user/persona/:id
   * Delete a persona
   */
  router.delete(
    '/:id',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const { id } = req.params;

      const idValidation = validateUuid(id, 'persona ID');
      if (!idValidation.valid) {
        sendError(res, idValidation.error);
        return;
      }

      const user = await getOrCreateInternalUser(prisma, discordUserId);

      const existing = await prisma.persona.findFirst({
        where: { id, ownerId: user.id },
        select: { id: true },
      });

      if (existing === null) {
        sendError(res, ErrorResponses.notFound('Persona'));
        return;
      }

      if (user.defaultPersonaId === id) {
        sendError(
          res,
          ErrorResponses.validationError(
            'Cannot delete your default persona. Set a different default first.'
          )
        );
        return;
      }

      await prisma.persona.delete({ where: { id } });

      logger.info({ userId: user.id, personaId: id }, '[Persona] Deleted persona');

      sendCustomSuccess(res, { message: 'Persona deleted' });
    })
  );
}
