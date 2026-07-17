/**
 * Personality alias management — /user/personality/:slug/aliases
 *
 * v2-parity surface over `personality_aliases`, whose rows ALSO resolve
 * @mentions at runtime (PersonalityLoader step 2, case-insensitive). Until
 * this route existed, v2-migrated aliases were invisible, unmanageable
 * routing data. All three verbs are edit-gated: aliases change how a
 * character is addressed platform-wide, so viewers don't get the list.
 *
 * Add-side collision rules (in check order):
 *  - exact-match against a personality NAME or SLUG the requester can see
 *    (public or their own) → rejected: the resolver checks names/slugs before
 *    aliases, so such an alias would be permanently shadowed (dead on
 *    arrival). The visibility scope mirrors PersonalityLoader's
 *    public-or-owned access filter — a private character someone else owns
 *    doesn't shadow anything for this user, and reporting it would leak its
 *    existence.
 *  - existing alias → 409 via the global unique constraint (P2002).
 * Alias ids are deterministic over the lowercased alias, so the same alias
 * created independently in both environments converges under db-sync.
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { CacheInvalidationService } from '@tzurot/cache-invalidation';
import { Prisma, type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  AddPersonalityAliasRequestSchema,
  AddPersonalityAliasResponseSchema,
  ListPersonalityAliasesResponseSchema,
  RemovePersonalityAliasResponseSchema,
} from '@tzurot/common-types/schemas/api/personality';
import { generatePersonalityAliasUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../../utils/resolveProvisionedUserId.js';
import { sendContractSuccess, sendError } from '../../../utils/responseHelpers.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { ProvisionedRequest } from '../../../types.js';
import { getParam } from '../../../utils/requestParams.js';
import { resolvePersonalityForEdit } from './helpers.js';
import type { RouteDeps } from '../../routeDeps.js';

const logger = createLogger('user-personality-aliases');

/** Ledger-bounded read: aliases per character are single digits in practice. */
const MAX_ALIASES = 100;

interface EditablePersonality {
  id: string;
  slug: string;
  ownerId: string;
}

/**
 * Thin route-local preamble over the shared resolvePersonalityForEdit:
 * slug guard + lookup + edit-permission gate. Returns null after sending
 * the error response.
 */
async function requireEditablePersonality(
  prisma: PrismaClient,
  req: ProvisionedRequest,
  res: Response
): Promise<EditablePersonality | null> {
  const slug = getParam(req.params.slug);
  if (slug === undefined || slug === '') {
    sendError(res, ErrorResponses.validationError('slug is required'));
    return null;
  }

  const resolved = await resolvePersonalityForEdit<EditablePersonality>({
    prisma,
    req,
    slug,
    res,
    options: {
      select: { id: true, slug: true, ownerId: true },
      action: 'manage aliases for',
    },
  });
  return resolved === null ? null : resolved.personality;
}

/**
 * Alias add/remove mutate how the personality resolves by name, so the
 * routing caches (HttpPersonalityLoader's positive 5-min tier and 60-s
 * negative tier) must be dropped eagerly — otherwise a removed alias keeps
 * routing (misrouting, if re-added to another character) and a fresh alias
 * sits behind a stale negative entry. Failure is non-fatal: the mutation
 * already committed and TTL expiry is the fallback (delete.ts pattern).
 */
async function invalidateCacheSafely(
  cacheInvalidationService: CacheInvalidationService | undefined,
  personalityId: string
): Promise<void> {
  if (!cacheInvalidationService) {
    return;
  }

  try {
    await cacheInvalidationService.invalidatePersonality(personalityId);
    logger.debug({ personalityId }, 'Invalidated personality cache after alias change');
  } catch (error) {
    logger.warn({ err: error, personalityId }, 'Failed to invalidate cache after alias change');
  }
}

// --- GET /user/personality/:slug/aliases ---

function createListHandler(prisma: PrismaClient) {
  return async (req: ProvisionedRequest, res: Response) => {
    const personality = await requireEditablePersonality(prisma, req, res);
    if (personality === null) {
      return;
    }

    const rows = await prisma.personalityAlias.findMany({
      where: { personalityId: personality.id },
      orderBy: { alias: 'asc' },
      take: MAX_ALIASES,
    });

    sendContractSuccess(res, ListPersonalityAliasesResponseSchema, {
      aliases: rows.map(row => ({ alias: row.alias, createdAt: row.createdAt.toISOString() })),
    });
  };
}

// --- POST /user/personality/:slug/aliases ---

function createAddHandler(
  prisma: PrismaClient,
  cacheInvalidationService?: CacheInvalidationService
) {
  return async (req: ProvisionedRequest, res: Response) => {
    const parseResult = AddPersonalityAliasRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const personality = await requireEditablePersonality(prisma, req, res);
    if (personality === null) {
      return;
    }
    const alias = parseResult.data.alias;
    const userId = resolveProvisionedUserId(req);

    // Shadow check: the resolver matches names/slugs BEFORE aliases, so an
    // alias equal to a name or slug could never fire. Scoped public-or-owned
    // to mirror the resolver's own access filter — an invisible (private,
    // someone else's) character neither shadows this user's alias nor may be
    // disclosed by this error path.
    const shadowing = await prisma.personality.findFirst({
      where: {
        AND: [
          { OR: [{ name: { equals: alias, mode: 'insensitive' } }, { slug: alias.toLowerCase() }] },
          { OR: [{ isPublic: true }, { ownerId: userId }] },
        ],
      },
      select: { id: true },
    });
    if (shadowing !== null) {
      return sendError(
        res,
        ErrorResponses.validationError(
          `"${alias}" matches an existing character's name or slug — an alias here would never resolve`
        )
      );
    }

    try {
      // The deterministic id is seeded from the LOWERCASED alias, so a
      // case-variant of an existing alias collides on the PK even though the
      // DB unique constraint on `alias` itself is case-sensitive — the P2002
      // below covers both collision shapes.
      const row = await prisma.personalityAlias.create({
        data: {
          id: generatePersonalityAliasUuid(alias),
          alias,
          personalityId: personality.id,
        },
      });
      logger.info({ slug: personality.slug, aliasId: row.id }, 'Alias added');
      await invalidateCacheSafely(cacheInvalidationService, personality.id);
      return sendContractSuccess(
        res,
        AddPersonalityAliasResponseSchema,
        { alias: { alias: row.alias, createdAt: row.createdAt.toISOString() } },
        StatusCodes.CREATED
      );
    } catch (error) {
      // Global unique constraint on alias (and the deterministic id): the
      // alias is taken — possibly by another character.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return sendError(res, ErrorResponses.conflict(`The alias "${alias}" is already in use`));
      }
      throw error;
    }
  };
}

// --- DELETE /user/personality/:slug/aliases/:alias ---

function createRemoveHandler(
  prisma: PrismaClient,
  cacheInvalidationService?: CacheInvalidationService
) {
  return async (req: ProvisionedRequest, res: Response) => {
    const personality = await requireEditablePersonality(prisma, req, res);
    if (personality === null) {
      return;
    }
    const alias = getParam(req.params.alias);
    if (alias === undefined || alias === '') {
      return sendError(res, ErrorResponses.validationError('alias is required'));
    }

    // Case-insensitive match, scoped to THIS personality — a same-named alias
    // on another character is untouchable from here.
    const row = await prisma.personalityAlias.findFirst({
      where: {
        personalityId: personality.id,
        alias: { equals: alias, mode: 'insensitive' },
      },
      select: { id: true, alias: true },
    });
    if (row === null) {
      return sendError(res, ErrorResponses.notFound('Alias'));
    }

    await prisma.personalityAlias.delete({ where: { id: row.id } });
    logger.info({ slug: personality.slug, aliasId: row.id }, 'Alias removed');
    await invalidateCacheSafely(cacheInvalidationService, personality.id);
    sendContractSuccess(res, RemovePersonalityAliasResponseSchema, { removedAlias: row.alias });
  };
}

// --- Handler factories + route chains ---

export const handleListPersonalityAliases = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createListHandler(deps.prisma));
export const handleAddPersonalityAlias = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createAddHandler(deps.prisma, deps.cacheInvalidationService));
export const handleRemovePersonalityAlias = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createRemoveHandler(deps.prisma, deps.cacheInvalidationService));
