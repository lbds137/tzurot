/**
 * GET /user/personality/:slug
 * Get a single personality by slug (if visible to user)
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  isBotOwner,
  PERSONALITY_DETAIL_SELECT,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../../types.js';
import { getParam } from '../../../utils/requestParams.js';
import { canUserEditPersonality } from './helpers.js';

const logger = createLogger('user-personality-get');

type PersonalityFromDb = Awaited<ReturnType<PrismaClient['personality']['findUnique']>> &
  NonNullable<unknown>;

interface PersonalityResponse {
  id: string;
  name: string;
  displayName: string | null;
  slug: string;
  characterInfo: string;
  personalityTraits: string;
  personalityTone: string | null;
  personalityAge: string | null;
  personalityAppearance: string | null;
  personalityLikes: string | null;
  personalityDislikes: string | null;
  conversationalGoals: string | null;
  conversationalExamples: string | null;
  errorMessage: string | null;
  birthMonth: number | null;
  birthDay: number | null;
  birthYear: number | null;
  isPublic: boolean;
  voiceEnabled: boolean;
  imageEnabled: boolean;
  extendedContext: boolean | null;
  extendedContextMaxMessages: number | null;
  extendedContextMaxAge: number | null;
  extendedContextMaxImages: number | null;
  ownerId: string;
  hasAvatar: boolean;
  customFields: unknown;
  systemPromptId: string | null;
  voiceSettings: unknown;
  imageSettings: unknown;
  createdAt: string;
  updatedAt: string;
}

// --- Helper Functions ---

async function checkUserAccess(
  prisma: PrismaClient,
  userId: string | undefined,
  personality: { id: string; isPublic: boolean; ownerId: string },
  discordUserId: string
): Promise<boolean> {
  if (isBotOwner(discordUserId)) {
    return true;
  }
  if (personality.isPublic) {
    return true;
  }
  if (userId !== undefined && personality.ownerId === userId) {
    return true;
  }

  if (userId !== undefined) {
    const ownerEntry = await prisma.personalityOwner.findUnique({
      where: { personalityId_userId: { personalityId: personality.id, userId } },
    });
    if (ownerEntry !== null) {
      return true;
    }
  }

  return false;
}

function formatPersonalityResponse(
  personality: NonNullable<PersonalityFromDb>
): PersonalityResponse {
  return {
    id: personality.id,
    name: personality.name,
    displayName: personality.displayName,
    slug: personality.slug,
    characterInfo: personality.characterInfo,
    personalityTraits: personality.personalityTraits,
    personalityTone: personality.personalityTone,
    personalityAge: personality.personalityAge,
    personalityAppearance: personality.personalityAppearance,
    personalityLikes: personality.personalityLikes,
    personalityDislikes: personality.personalityDislikes,
    conversationalGoals: personality.conversationalGoals,
    conversationalExamples: personality.conversationalExamples,
    errorMessage: personality.errorMessage,
    birthMonth: personality.birthMonth,
    birthDay: personality.birthDay,
    birthYear: personality.birthYear,
    isPublic: personality.isPublic,
    voiceEnabled: personality.voiceEnabled,
    imageEnabled: personality.imageEnabled,
    extendedContext: personality.extendedContext,
    extendedContextMaxMessages: personality.extendedContextMaxMessages,
    extendedContextMaxAge: personality.extendedContextMaxAge,
    extendedContextMaxImages: personality.extendedContextMaxImages,
    ownerId: personality.ownerId,
    hasAvatar: personality.avatarData !== null,
    customFields: personality.customFields,
    systemPromptId: personality.systemPromptId,
    voiceSettings: personality.voiceSettings,
    imageSettings: personality.imageSettings,
    createdAt: personality.createdAt.toISOString(),
    updatedAt: personality.updatedAt.toISOString(),
  };
}

// --- Handler Factory ---

function createHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const slug = getParam(req.params.slug);

    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    const personality = await prisma.personality.findUnique({
      where: { slug },
      select: PERSONALITY_DETAIL_SELECT,
    });

    if (personality === null) {
      return sendError(res, ErrorResponses.notFound('Personality not found'));
    }

    const hasAccess = await checkUserAccess(prisma, user?.id, personality, discordUserId);
    if (!hasAccess) {
      return sendError(
        res,
        ErrorResponses.unauthorized('You do not have access to this personality')
      );
    }

    const canEdit =
      user !== null &&
      (await canUserEditPersonality(prisma, user.id, personality.id, discordUserId));

    logger.info({ discordUserId, slug, canEdit }, '[Personality] Retrieved personality');

    sendCustomSuccess(
      res,
      { personality: formatPersonalityResponse(personality), canEdit },
      StatusCodes.OK
    );
  };
}

// --- Route Factory ---

export function createGetHandler(prisma: PrismaClient): RequestHandler[] {
  return [requireUserAuth(), asyncHandler(createHandler(prisma))];
}
