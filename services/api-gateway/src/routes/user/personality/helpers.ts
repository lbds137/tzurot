/**
 * Personality Route Helpers
 * Shared utility functions for personality CRUD operations
 */

import type { Response } from 'express';
import { Prisma, type PrismaClient, type UserService, isBotOwner } from '@tzurot/common-types';
import { resolveProvisionedUserId } from '../../../utils/resolveProvisionedUserId.js';
import type { ProvisionedRequest } from '../../../types.js';
import { sendError } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';

/**
 * Options for checking if user can view a personality
 */
interface CanUserViewPersonalityOptions {
  /** Prisma client instance */
  prisma: PrismaClient;
  /** Internal database user ID (null if not found) */
  userId: string | null;
  /** Personality ID to check */
  personalityId: string;
  /** Whether the personality is public */
  isPublic: boolean;
  /** Owner ID of the personality */
  ownerId: string;
  /** Discord user ID (for bot owner check) */
  discordUserId: string;
}

/**
 * Check if user can edit a personality (owns it directly or via PersonalityOwner)
 * Bot owner can edit any personality.
 *
 * @param prisma - Prisma client
 * @param userId - Internal database user ID
 * @param personalityId - Personality ID to check
 * @param discordUserId - Discord user ID (for bot owner check)
 */
export async function canUserEditPersonality(
  prisma: PrismaClient,
  userId: string,
  personalityId: string,
  discordUserId?: string
): Promise<boolean> {
  // Bot owner bypass - can edit any personality
  if (discordUserId !== undefined && isBotOwner(discordUserId)) {
    return true;
  }

  // Single query to check both direct ownership and PersonalityOwner table
  const personality = await prisma.personality.findUnique({
    where: { id: personalityId },
    select: { ownerId: true },
    // Note: We can't nest relations in select, so we do a separate check
  });

  if (personality === null) {
    return false;
  }

  // Check direct ownership first (most common case)
  if (personality.ownerId === userId) {
    return true;
  }

  // Check PersonalityOwner table for co-ownership
  const ownerEntry = await prisma.personalityOwner.findUnique({
    where: {
      personalityId_userId: {
        personalityId,
        userId,
      },
    },
  });

  return ownerEntry !== null;
}

/**
 * Check if user has view access to a personality
 * Access is granted if:
 * - User is bot owner (admin bypass)
 * - Personality is public
 * - User owns the personality directly
 * - User is in PersonalityOwner table
 */
export async function canUserViewPersonality(
  options: CanUserViewPersonalityOptions
): Promise<boolean> {
  const { prisma, userId, personalityId, isPublic, ownerId, discordUserId } = options;

  // Bot owner can view any personality
  if (isBotOwner(discordUserId)) {
    return true;
  }

  // Public personalities are viewable by everyone
  if (isPublic) {
    return true;
  }

  // User must exist and be owner
  if (userId === null) {
    return false;
  }

  // Check direct ownership
  if (ownerId === userId) {
    return true;
  }

  // Check PersonalityOwner table
  const ownerEntry = await prisma.personalityOwner.findUnique({
    where: {
      personalityId_userId: {
        personalityId,
        userId,
      },
    },
  });

  return ownerEntry !== null;
}

/**
 * Options for resolvePersonalityForEdit.
 *
 * The generic type parameter T on the function must exactly match the shape
 * produced by `select`. Callers are on the honor system for this — TypeScript
 * can't infer T from a Prisma select clause, so the cast uses `as unknown as T`.
 */
interface ResolvePersonalityOptions {
  /** Prisma select clause — must include `id` and `ownerId` */
  select: Prisma.PersonalitySelect & { id: true; ownerId: true };
  /** Verb for the permission error message (default: 'edit') */
  action?: string;
}

interface ResolvePersonalityForEditParams {
  prisma: PrismaClient;
  userService: UserService;
  req: ProvisionedRequest;
  slug: string;
  res: Response;
  options: ResolvePersonalityOptions;
}

/**
 * Resolve the current user's internal UUID, look up a personality by slug,
 * and verify edit permission. Sends appropriate error responses and returns
 * null if any check fails.
 *
 * Callers specify a Prisma select clause; the result personality is cast to T.
 * The select MUST include `id` and `ownerId` — enforced at the type level.
 *
 * Contract change vs. pre-Phase-5c: this helper used to return a deliberate
 * HTTP 403 ("User not found") when the caller's Discord ID didn't resolve to
 * a users row. Post-Phase-5c, every user-scoped route runs behind
 * `requireProvisionedUser`, which either attaches `req.provisionedUserId`
 * directly or (during the shadow-mode window) delegates to
 * `getOrCreateUserShell` — both of which guarantee the user exists by the
 * time this helper runs. The only remaining path where `resolveProvisionedUserId`
 * could throw is infrastructure (DB down, $executeRaw failure during shell
 * creation). Those correctly surface as HTTP 500 via `asyncHandler`, which
 * is the right shape for infra errors; a 403 would misrepresent them as an
 * auth problem. If this guarantee ever changes (e.g., `requireProvisionedUser`
 * is loosened), this helper must grow its own try/catch again.
 */
export async function resolvePersonalityForEdit<T extends { id: string; ownerId: string }>(
  params: ResolvePersonalityForEditParams
): Promise<{ user: { id: string }; personality: T } | null> {
  const { prisma, userService, req, slug, res, options } = params;
  const { select, action = 'edit' } = options;
  const discordUserId = req.userId;

  const userId = await resolveProvisionedUserId(req, userService);

  const personality = await prisma.personality.findUnique({ where: { slug }, select });
  if (personality === null) {
    sendError(res, ErrorResponses.notFound('Personality'));
    return null;
  }

  const canEdit = await canUserEditPersonality(
    prisma,
    userId,
    (personality as { id: string }).id,
    discordUserId
  );
  if (!canEdit) {
    sendError(
      res,
      ErrorResponses.unauthorized(`You do not have permission to ${action} this personality`)
    );
    return null;
  }

  // Cast through unknown: Prisma's full model type doesn't structurally overlap with T,
  // but the select clause ensures only the requested fields are present at runtime.
  return { user: { id: userId }, personality: personality as unknown as T };
}
