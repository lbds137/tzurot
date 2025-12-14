/* eslint-disable max-lines */
// TODO: TECH DEBT - Split this 650+ line file into separate route modules:
// - crud.ts (list, get, create, update, delete)
// - default.ts (set default persona)
// - settings.ts (update persona settings)
// - override.ts (override CRUD)

/**
 * User Persona Routes
 * CRUD operations for user personas (profiles that tell AI about the user)
 *
 * Endpoints:
 * - GET /user/persona - List user's personas
 * - GET /user/persona/:id - Get a specific persona
 * - POST /user/persona - Create a new persona
 * - PUT /user/persona/:id - Update a persona
 * - DELETE /user/persona/:id - Delete a persona
 * - PATCH /user/persona/:id/default - Set persona as user's default
 * - PATCH /user/persona/settings - Update persona settings (share-ltm)
 * - GET /user/persona/override - List persona overrides for personalities
 * - PUT /user/persona/override/:personalitySlug - Set persona override for a personality
 * - DELETE /user/persona/override/:personalitySlug - Clear persona override
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  generateUserPersonalityConfigUuid,
  type PrismaClient,
  DISCORD_LIMITS,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { validateUuid, validateSlug } from '../../utils/validators.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('user-persona');

/**
 * Persona summary for list responses
 */
interface PersonaSummary {
  id: string;
  name: string;
  preferredName: string | null;
  description: string | null;
  isDefault: boolean;
  shareLtmAcrossPersonalities: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Full persona details for single-item responses
 */
interface PersonaDetails extends PersonaSummary {
  content: string;
  pronouns: string | null;
}

/**
 * Request body for creating a persona
 */
interface CreatePersonaBody {
  name: string;
  preferredName?: string;
  description?: string;
  content: string;
  pronouns?: string;
}

/**
 * Request body for updating a persona
 */
interface UpdatePersonaBody {
  name?: string;
  preferredName?: string;
  description?: string;
  content?: string;
  pronouns?: string;
}

/**
 * Request body for settings update
 */
interface SettingsBody {
  shareLtmAcrossPersonalities: boolean;
}

/**
 * Request body for persona override
 */
interface OverrideBody {
  personaId: string;
}

/**
 * Helper to safely extract string from body with trim
 */
function extractString(value: unknown, allowEmpty = false): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return allowEmpty || trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

/**
 * Persona override summary
 */
interface PersonaOverrideSummary {
  personalityId: string;
  personalitySlug: string;
  personalityName: string;
  personaId: string;
  personaName: string;
}

/**
 * Get or create internal user from Discord ID
 */
async function getOrCreateInternalUser(
  prisma: PrismaClient,
  discordUserId: string
): Promise<{ id: string; defaultPersonaId: string | null }> {
  let user = await prisma.user.findFirst({
    where: { discordId: discordUserId },
    select: { id: true, defaultPersonaId: true },
  });

  // Create user if they don't exist
  user ??= await prisma.user.create({
    data: {
      discordId: discordUserId,
      username: discordUserId, // Placeholder
    },
    select: { id: true, defaultPersonaId: true },
  });

  return user;
}

export function createPersonaRoutes(prisma: PrismaClient): Router {
  const router = Router();

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
        isDefault: p.id === user.defaultPersonaId,
        shareLtmAcrossPersonalities: p.shareLtmAcrossPersonalities,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }));

      sendCustomSuccess(res, { personas: response });
    })
  );

  /**
   * GET /user/persona/override
   * List all persona overrides for specific personalities
   * NOTE: Must be defined BEFORE /:id route to avoid being caught by parameter
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
        // Skip entries without persona (type narrowing)
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
   * NOTE: Must be defined BEFORE /:id route to avoid being caught by parameter
   */
  router.get(
    '/override/:personalitySlug',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const { personalitySlug } = req.params;

      // Validate slug format
      const slugValidation = validateSlug(personalitySlug);
      if (!slugValidation.valid) {
        sendError(res, slugValidation.error);
        return;
      }

      // Find the personality
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
   * GET /user/persona/:id
   * Get a specific persona by ID
   */
  router.get(
    '/:id',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const { id } = req.params;

      // Validate UUID format
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

      // Extract and validate required fields
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

      // SECURITY NOTE: Persona content is user-generated and will be injected into AI prompts.
      // Prompt injection prevention is handled at the prompt building stage (ai-worker) using
      // escapeXmlContent() which escapes protected XML tags. We don't sanitize here because:
      // 1. Multiple content paths converge at PromptBuilder
      // 2. Content may be transformed before reaching the prompt
      // 3. Sanitization at prompt-building time ensures consistent protection

      // Extract optional fields
      const preferredNameValue = extractString(body.preferredName);
      const descriptionValue = extractString(body.description);
      const pronounsValue = extractString(body.pronouns);

      const user = await getOrCreateInternalUser(prisma, discordUserId);

      const persona = await prisma.persona.create({
        data: {
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

      // Set as default if this is the user's first persona
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

      // Validate UUID format
      const idValidation = validateUuid(id, 'persona ID');
      if (!idValidation.valid) {
        sendError(res, idValidation.error);
        return;
      }

      const user = await getOrCreateInternalUser(prisma, discordUserId);

      // Check ownership
      const existing = await prisma.persona.findFirst({
        where: { id, ownerId: user.id },
        select: { id: true },
      });

      if (existing === null) {
        sendError(res, ErrorResponses.notFound('Persona'));
        return;
      }

      // Validate and extract fields
      const updateData: {
        name?: string;
        preferredName?: string | null;
        description?: string | null;
        content?: string;
        pronouns?: string | null;
      } = {};

      // Name: required to be non-empty if provided
      if (body.name !== undefined) {
        const nameValue = extractString(body.name);
        if (nameValue === null) {
          sendError(res, ErrorResponses.validationError('Name cannot be empty'));
          return;
        }
        updateData.name = nameValue;
      }

      // Content: required to be non-empty if provided
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

      // Optional fields (can be set to null)
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

      // Validate UUID format
      const idValidation = validateUuid(id, 'persona ID');
      if (!idValidation.valid) {
        sendError(res, idValidation.error);
        return;
      }

      const user = await getOrCreateInternalUser(prisma, discordUserId);

      // Check ownership
      const existing = await prisma.persona.findFirst({
        where: { id, ownerId: user.id },
        select: { id: true },
      });

      if (existing === null) {
        sendError(res, ErrorResponses.notFound('Persona'));
        return;
      }

      // Don't allow deleting the default persona
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

  /**
   * PATCH /user/persona/:id/default
   * Set a persona as the user's default
   */
  router.patch(
    '/:id/default',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const { id } = req.params;

      // Validate UUID format
      const idValidation = validateUuid(id, 'persona ID');
      if (!idValidation.valid) {
        sendError(res, idValidation.error);
        return;
      }

      const user = await getOrCreateInternalUser(prisma, discordUserId);

      // Check ownership
      const persona = await prisma.persona.findFirst({
        where: { id, ownerId: user.id },
        select: { id: true, name: true, preferredName: true },
      });

      if (persona === null) {
        sendError(res, ErrorResponses.notFound('Persona'));
        return;
      }

      // Check if already default
      const alreadyDefault = user.defaultPersonaId === id;

      if (!alreadyDefault) {
        await prisma.user.update({
          where: { id: user.id },
          data: { defaultPersonaId: id },
        });
      }

      logger.info(
        { userId: user.id, personaId: id, alreadyDefault },
        '[Persona] Set default persona'
      );

      sendCustomSuccess(res, {
        success: true,
        persona: {
          id: persona.id,
          name: persona.name,
          preferredName: persona.preferredName,
        },
        alreadyDefault,
      });
    })
  );

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
      const body = req.body as Partial<SettingsBody>;
      const { shareLtmAcrossPersonalities } = body;

      if (typeof shareLtmAcrossPersonalities !== 'boolean') {
        sendError(
          res,
          ErrorResponses.validationError('shareLtmAcrossPersonalities must be a boolean')
        );
        return;
      }

      const user = await getOrCreateInternalUser(prisma, discordUserId);

      if (user.defaultPersonaId === null) {
        sendError(
          res,
          ErrorResponses.validationError('No default persona set. Create a profile first.')
        );
        return;
      }

      // Check current value to determine if it's unchanged
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

      // Validate slug format
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

      // Validate persona ID format
      const personaIdValidation = validateUuid(personaIdValue, 'persona ID');
      if (!personaIdValidation.valid) {
        sendError(res, personaIdValidation.error);
        return;
      }

      const user = await getOrCreateInternalUser(prisma, discordUserId);

      // Verify persona ownership
      const persona = await prisma.persona.findFirst({
        where: { id: personaIdValue, ownerId: user.id },
        select: { id: true, name: true, preferredName: true },
      });

      if (persona === null) {
        sendError(res, ErrorResponses.notFound('Persona'));
        return;
      }

      // Find the personality
      const personality = await prisma.personality.findUnique({
        where: { slug: personalitySlug },
        select: { id: true, name: true, displayName: true },
      });

      if (personality === null) {
        sendError(res, ErrorResponses.notFound('Personality'));
        return;
      }

      // Upsert the override (use deterministic UUID for cross-env sync)
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

      // Validate slug format
      const slugValidation = validateSlug(personalitySlug);
      if (!slugValidation.valid) {
        sendError(res, slugValidation.error);
        return;
      }

      const user = await getOrCreateInternalUser(prisma, discordUserId);

      // Find the personality
      const personality = await prisma.personality.findUnique({
        where: { slug: personalitySlug },
        select: { id: true, name: true, displayName: true },
      });

      if (personality === null) {
        sendError(res, ErrorResponses.notFound('Personality'));
        return;
      }

      // Find the existing config to determine how to handle deletion
      const existing = await prisma.userPersonalityConfig.findUnique({
        where: {
          userId_personalityId: {
            userId: user.id,
            personalityId: personality.id,
          },
        },
        select: { id: true, llmConfigId: true },
      });

      // No config exists - nothing to delete
      if (!existing) {
        // Still return success - idempotent behavior
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

      // Config has both persona and LLM override - just clear the persona part
      if (existing.llmConfigId !== null) {
        await prisma.userPersonalityConfig.update({
          where: { id: existing.id },
          data: { personaId: null },
        });
      } else {
        // Config only had persona override - delete the entire record
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

  return router;
}
