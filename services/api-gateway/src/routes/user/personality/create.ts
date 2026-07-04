/**
 * POST /user/personality
 * Create a new personality owned by the user
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  PersonalityCreateSchema,
  type PersonalityCreateInput,
  PERSONALITY_DETAIL_SELECT,
} from '@tzurot/common-types/schemas/api/personality';
import { type Prisma } from '@tzurot/common-types/services/prisma';
import { generatePersonalityUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { requireUserAuth, requireProvisionedUser } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import { validateSlug } from '../../../utils/validators.js';
import { processAvatarData } from '../../../utils/avatarProcessor.js';
import { processVoiceReferenceData } from '../../../utils/voiceReferenceProcessor.js';
import { formatPersonalityResponse } from './formatters.js';
import type { ProvisionedRequest } from '../../../types.js';
import { getOrCreateInternalUser } from '../userHelpers.js';
import type { RouteDeps } from '../../routeDeps.js';

const logger = createLogger('user-personality-create');

/**
 * Build Prisma create data from validated input
 */
interface MediaBuffers {
  avatarBuffer?: Buffer;
  voiceReferenceBuffer?: Buffer;
  voiceReferenceMimeType?: string;
}

function buildCreateData(
  body: PersonalityCreateInput,
  ownerId: string,
  systemPromptId: string | null,
  media: MediaBuffers
): Prisma.PersonalityUncheckedCreateInput {
  const hasDisplayName =
    body.displayName !== null && body.displayName !== undefined && body.displayName !== '';
  return {
    id: generatePersonalityUuid(body.slug),
    name: body.name,
    slug: body.slug,
    displayName: hasDisplayName ? body.displayName : body.name,
    characterInfo: body.characterInfo,
    personalityTraits: body.personalityTraits,
    personalityTone: body.personalityTone ?? null,
    personalityAge: body.personalityAge ?? null,
    personalityAppearance: body.personalityAppearance ?? null,
    personalityLikes: body.personalityLikes ?? null,
    personalityDislikes: body.personalityDislikes ?? null,
    conversationalGoals: body.conversationalGoals ?? null,
    conversationalExamples: body.conversationalExamples ?? null,
    errorMessage: body.errorMessage ?? null,
    isPublic: body.isPublic ?? false,
    ownerId,
    systemPromptId,
    avatarData: media.avatarBuffer !== undefined ? new Uint8Array(media.avatarBuffer) : null,
    voiceReferenceData:
      media.voiceReferenceBuffer !== undefined ? new Uint8Array(media.voiceReferenceBuffer) : null,
    voiceReferenceType: media.voiceReferenceMimeType ?? null,
    voiceEnabled: false,
    imageEnabled: false,
  };
}

/**
 * POST /api/user/personality — create a new personality owned by the user.
 */
export const handleCreatePersonality = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;

    // Validate request body with Zod schema
    const parseResult = PersonalityCreateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const body: PersonalityCreateInput = parseResult.data;
    const { slug } = body;

    // Validate business rules that Zod doesn't cover (reserved slugs, consecutive hyphens, trailing hyphens)
    const slugValidation = validateSlug(slug);
    if (!slugValidation.valid) {
      return sendError(res, slugValidation.error);
    }

    // Check if personality already exists
    const existing = await prisma.personality.findUnique({ where: { slug } });
    if (existing !== null) {
      return sendError(
        res,
        ErrorResponses.conflict(`A personality with slug '${slug}' already exists`)
      );
    }

    // Process avatar if provided
    const avatarResult = await processAvatarData(body.avatarData, slug);
    if (avatarResult !== null && !avatarResult.ok) {
      return sendError(res, avatarResult.error);
    }

    // Process voice reference if provided
    const voiceRefResult = processVoiceReferenceData(body.voiceReferenceData, slug);
    if (voiceRefResult !== null && !voiceRefResult.ok) {
      return sendError(res, voiceRefResult.error);
    }

    // Read provisioned user (sync, no Prisma call) and look up the default
    // system prompt. Parallel was meaningful when getOrCreateInternalUser was
    // async and hit Prisma; post-Identity-Hardening it's a sync passthrough.
    const user = getOrCreateInternalUser(req);
    const defaultSystemPrompt = await prisma.systemPrompt.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });

    // Create personality in database
    const createData = buildCreateData(body, user.id, defaultSystemPrompt?.id ?? null, {
      avatarBuffer: avatarResult?.ok === true ? avatarResult.buffer : undefined,
      voiceReferenceBuffer: voiceRefResult?.ok === true ? voiceRefResult.buffer : undefined,
      voiceReferenceMimeType: voiceRefResult?.ok === true ? voiceRefResult.mimeType : undefined,
    });
    const personality = await prisma.personality.create({
      data: createData,
      select: PERSONALITY_DETAIL_SELECT,
    });

    logger.info({ discordUserId, slug, personalityId: personality.id }, 'Created personality');

    // Note: personality_default_configs is intentionally NOT populated here.
    // Personalities cascade to the current global default at request time; a
    // per-personality preset pin is an opt-in override, not a creation-time
    // snapshot. See the "Preset cascade standardization" backlog epic.
    sendCustomSuccess(
      res,
      { success: true, personality: formatPersonalityResponse(personality) },
      StatusCodes.CREATED
    );
  });
};

export function createCreateHandler(deps: RouteDeps): RequestHandler[] {
  return [requireUserAuth(), requireProvisionedUser(deps.prisma), handleCreatePersonality(deps)];
}
