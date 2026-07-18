/**
 * Personality alias management — /user/personality/:slug/aliases
 *
 * Two-tier model over `personality_aliases` (rows ALSO resolve @mentions at
 * runtime — PersonalityLoader's alias step, personal before global):
 *  - GLOBAL rows (user_id IS NULL): resolve for everyone. Writes are
 *    bot-owner-only — a global alias is an owner blessing, not a
 *    character-owner right.
 *  - USER rows (user_id = caller): resolve only for their owner. Any
 *    provisioned user may create them on any character they can SEE.
 *
 * All verbs are visibility-gated (an invisible character 404s — same shape
 * as missing, so existence never leaks). List returns global rows plus the
 * CALLER's own personal rows, never other users'.
 *
 * Add-side collision rules (in check order):
 *  - exact-match against a personality NAME or SLUG → rejected: the resolver
 *    checks names/slugs before aliases, so such an alias would be dead on
 *    arrival. Scope of the check mirrors who the alias would resolve for:
 *    a USER alias checks the caller's visible characters (public or own —
 *    the resolver's own access filter); a GLOBAL alias checks all
 *    characters (it resolves for everyone, and the bot owner sees all, so
 *    nothing leaks).
 *  - per-tier cap (MAX_ALIASES_PER_SCOPE) → rejected with a clean count.
 *  - existing alias in the same tier → 409 via the partial unique indexes
 *    on lower(alias) (P2002).
 * Alias ids are deterministic (global: lowercased alias; user:
 * userId + lowercased alias), so rows created independently in both
 * environments converge under db-sync.
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { CacheInvalidationService } from '@tzurot/cache-invalidation';
import { Prisma, type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  AddPersonalityAliasRequestSchema,
  AddPersonalityAliasResponseSchema,
  AliasScopeSchema,
  ListMyAliasesResponseSchema,
  ListPersonalityAliasesResponseSchema,
  RemovePersonalityAliasResponseSchema,
  type AliasScope,
} from '@tzurot/common-types/schemas/api/personality';
import {
  generatePersonalityAliasUuid,
  generateUserPersonalityAliasUuid,
} from '@tzurot/common-types/utils/deterministicUuid';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../../utils/resolveProvisionedUserId.js';
import { sendContractSuccess, sendError } from '../../../utils/responseHelpers.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { ProvisionedRequest } from '../../../types.js';
import { getParam } from '../../../utils/requestParams.js';
import { canUserViewPersonality } from './helpers.js';
import type { RouteDeps } from '../../routeDeps.js';

const logger = createLogger('user-personality-aliases');

/** Per-tier write cap: global rows per character, and personal rows per user
 *  (cross-character). Keeps both the resolver's alias sweep and the browse
 *  surface bounded. */
const MAX_ALIASES_PER_SCOPE = 25;

/** Ledger-bounded reads: per-character list (≤25 global + ≤25 of the
 *  caller's) and the cross-character overview both fit comfortably. */
const MAX_LIST_ROWS = 100;

interface VisiblePersonality {
  id: string;
  slug: string;
  ownerId: string;
  isPublic: boolean;
}

/**
 * Slug guard + lookup + VISIBILITY gate (alias management is
 * visibility-scoped, not edit-scoped). Missing and invisible both 404 with
 * the same shape so existence never leaks. Returns null after sending the
 * error response.
 */
async function requireVisiblePersonality(
  prisma: PrismaClient,
  req: ProvisionedRequest,
  res: Response
): Promise<VisiblePersonality | null> {
  const slug = getParam(req.params.slug);
  if (slug === undefined || slug === '') {
    sendError(res, ErrorResponses.validationError('slug is required'));
    return null;
  }

  const personality = await prisma.personality.findUnique({
    where: { slug },
    select: { id: true, slug: true, ownerId: true, isPublic: true },
  });
  if (personality === null) {
    sendError(res, ErrorResponses.notFound('Personality'));
    return null;
  }

  const visible = await canUserViewPersonality({
    prisma,
    userId: resolveProvisionedUserId(req),
    personalityId: personality.id,
    isPublic: personality.isPublic,
    ownerId: personality.ownerId,
    discordUserId: req.userId ?? '',
  });
  if (!visible) {
    sendError(res, ErrorResponses.notFound('Personality'));
    return null;
  }

  return personality;
}

/**
 * Alias add/remove mutate how the personality resolves by name, so the
 * routing caches (HttpPersonalityLoader's positive 5-min tier and 60-s
 * negative tier) must be dropped eagerly — otherwise a removed alias keeps
 * routing (misrouting, if re-added to another character) and a fresh alias
 * sits behind a stale negative entry. The invalidation is a full clear of
 * both tiers, so user-scoped writes ride the same event. Failure is
 * non-fatal: the mutation already committed and TTL expiry is the fallback
 * (delete.ts pattern).
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

function rowScope(row: { userId: string | null }): AliasScope {
  return row.userId === null ? 'global' : 'user';
}

// --- GET /user/personality/:slug/aliases ---

function createListHandler(prisma: PrismaClient) {
  return async (req: ProvisionedRequest, res: Response) => {
    const personality = await requireVisiblePersonality(prisma, req, res);
    if (personality === null) {
      return;
    }
    const callerUuid = resolveProvisionedUserId(req);

    const rows = await prisma.personalityAlias.findMany({
      where: {
        personalityId: personality.id,
        OR: [{ userId: null }, { userId: callerUuid }],
      },
      orderBy: { alias: 'asc' },
      take: MAX_LIST_ROWS + 1,
    });
    const truncated = rows.length > MAX_LIST_ROWS;
    const page = truncated ? rows.slice(0, MAX_LIST_ROWS) : rows;

    sendContractSuccess(res, ListPersonalityAliasesResponseSchema, {
      aliases: page.map(row => ({
        alias: row.alias,
        scope: rowScope(row),
        createdAt: row.createdAt.toISOString(),
      })),
      truncated,
    });
  };
}

// --- POST /user/personality/:slug/aliases ---

/** Shadow check: the resolver matches names/slugs BEFORE aliases, so an
 *  alias equal to a name or slug could never fire. The visibility scope of
 *  the check mirrors who the alias resolves for (see module doc). Returns
 *  true (and sends the error) when shadowed. */
async function rejectIfShadowed(
  prisma: PrismaClient,
  res: Response,
  alias: string,
  scope: AliasScope,
  callerUuid: string
): Promise<boolean> {
  const nameOrSlugMatch = {
    OR: [{ name: { equals: alias, mode: 'insensitive' as const } }, { slug: alias.toLowerCase() }],
  };
  const shadowing = await prisma.personality.findFirst({
    where:
      scope === 'global'
        ? nameOrSlugMatch
        : { AND: [nameOrSlugMatch, { OR: [{ isPublic: true }, { ownerId: callerUuid }] }] },
    select: { id: true },
  });
  if (shadowing !== null) {
    sendError(
      res,
      ErrorResponses.validationError(
        `"${alias}" matches an existing character's name or slug — an alias here would never resolve`
      )
    );
    return true;
  }
  return false;
}

/** Per-tier write cap. Returns true (and sends the error) when at cap.
 *  SOFT cap by design: the count runs outside the create's transaction, so
 *  concurrent adds of distinct aliases can briefly overshoot the limit. The
 *  cap is a UX guardrail, not a consistency invariant — the partial unique
 *  indexes remain the hard guarantee — so a transaction isn't worth its
 *  contention here. */
async function rejectIfAtCap(
  prisma: PrismaClient,
  res: Response,
  scope: AliasScope,
  personalityId: string,
  callerUuid: string
): Promise<boolean> {
  const count =
    scope === 'global'
      ? await prisma.personalityAlias.count({ where: { personalityId, userId: null } })
      : await prisma.personalityAlias.count({ where: { userId: callerUuid } });
  if (count >= MAX_ALIASES_PER_SCOPE) {
    const subject =
      scope === 'global'
        ? `This character already has the maximum of ${MAX_ALIASES_PER_SCOPE} global aliases`
        : `You already have the maximum of ${MAX_ALIASES_PER_SCOPE} personal aliases`;
    sendError(res, ErrorResponses.validationError(subject));
    return true;
  }
  return false;
}

function createAddHandler(
  prisma: PrismaClient,
  cacheInvalidationService?: CacheInvalidationService
) {
  return async (req: ProvisionedRequest, res: Response) => {
    const parseResult = AddPersonalityAliasRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const { alias, scope } = parseResult.data;

    if (scope === 'global' && !isBotOwner(req.userId ?? '')) {
      return sendError(
        res,
        ErrorResponses.forbidden('Global aliases can only be managed by the bot owner')
      );
    }

    const personality = await requireVisiblePersonality(prisma, req, res);
    if (personality === null) {
      return;
    }
    const callerUuid = resolveProvisionedUserId(req);

    if (await rejectIfShadowed(prisma, res, alias, scope, callerUuid)) {
      return;
    }
    if (await rejectIfAtCap(prisma, res, scope, personality.id, callerUuid)) {
      return;
    }

    try {
      const row = await prisma.personalityAlias.create({
        data: {
          id:
            scope === 'global'
              ? generatePersonalityAliasUuid(alias)
              : generateUserPersonalityAliasUuid(callerUuid, alias),
          alias,
          personalityId: personality.id,
          userId: scope === 'global' ? null : callerUuid,
        },
      });
      logger.info({ slug: personality.slug, aliasId: row.id, scope }, 'Alias added');
      await invalidateCacheSafely(cacheInvalidationService, personality.id);
      return sendContractSuccess(
        res,
        AddPersonalityAliasResponseSchema,
        {
          alias: { alias: row.alias, scope, createdAt: row.createdAt.toISOString() },
        },
        StatusCodes.CREATED
      );
    } catch (error) {
      // Partial unique on lower(alias) within the tier (and the deterministic
      // id): the alias is taken in that tier — possibly on another character.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const message =
          scope === 'global'
            ? `The alias "${alias}" is already in use`
            : `You already have a personal alias "${alias}"`;
        return sendError(res, ErrorResponses.conflict(message));
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
    // ?scope= defaults to 'user': removing your own alias is the common
    // case; global removal is the bot owner's explicit act.
    const scopeParse = AliasScopeSchema.default('user').safeParse(
      typeof req.query.scope === 'string' ? req.query.scope : undefined
    );
    if (!scopeParse.success) {
      return sendZodError(res, scopeParse.error);
    }
    const scope = scopeParse.data;

    if (scope === 'global' && !isBotOwner(req.userId ?? '')) {
      return sendError(
        res,
        ErrorResponses.forbidden('Global aliases can only be managed by the bot owner')
      );
    }

    const personality = await requireVisiblePersonality(prisma, req, res);
    if (personality === null) {
      return;
    }
    const alias = getParam(req.params.alias);
    if (alias === undefined || alias === '') {
      return sendError(res, ErrorResponses.validationError('alias is required'));
    }
    const callerUuid = resolveProvisionedUserId(req);

    // Case-insensitive match, scoped to THIS personality AND the requested
    // tier — a same-named alias in the other tier (or on another character,
    // or another user's row) is untouchable from here.
    const row = await prisma.personalityAlias.findFirst({
      where: {
        personalityId: personality.id,
        alias: { equals: alias, mode: 'insensitive' },
        userId: scope === 'global' ? null : callerUuid,
      },
      select: { id: true, alias: true, userId: true },
    });
    if (row === null) {
      return sendError(res, ErrorResponses.notFound('Alias'));
    }

    await prisma.personalityAlias.delete({ where: { id: row.id } });
    logger.info({ slug: personality.slug, aliasId: row.id, scope }, 'Alias removed');
    await invalidateCacheSafely(cacheInvalidationService, personality.id);
    sendContractSuccess(res, RemovePersonalityAliasResponseSchema, {
      removedAlias: row.alias,
      removedScope: scope,
    });
  };
}

// --- GET /user/personality/my-aliases ---

function createMyAliasesHandler(prisma: PrismaClient) {
  return async (req: ProvisionedRequest, res: Response) => {
    const callerUuid = resolveProvisionedUserId(req);
    const callerIsBotOwner = isBotOwner(req.userId ?? '');

    // The caller's personal rows across all characters; the bot owner also
    // sees every global row (they're the only one who can manage those).
    const rows = await prisma.personalityAlias.findMany({
      where: callerIsBotOwner
        ? { OR: [{ userId: callerUuid }, { userId: null }] }
        : { userId: callerUuid },
      include: { personality: { select: { id: true, name: true, slug: true } } },
      orderBy: { alias: 'asc' },
      take: MAX_LIST_ROWS + 1,
    });
    const truncated = rows.length > MAX_LIST_ROWS;
    const page = truncated ? rows.slice(0, MAX_LIST_ROWS) : rows;

    // Shadow marking: an alias equal to a character name/slug VISIBLE TO THE
    // CALLER never resolves for them (names/slugs win). Computed per-caller,
    // so no other user's private characters leak into the flag. One batched
    // query over the page's alias texts.
    const aliasTexts = page.map(row => row.alias);
    const shadowedKeys = new Set<string>();
    if (aliasTexts.length > 0) {
      const nameOrSlugMatch = {
        OR: [
          { name: { in: aliasTexts, mode: 'insensitive' as const } },
          { slug: { in: aliasTexts.map(text => text.toLowerCase()) } },
        ],
      };
      const shadowing = await prisma.personality.findMany({
        where: callerIsBotOwner
          ? nameOrSlugMatch
          : { AND: [nameOrSlugMatch, { OR: [{ isPublic: true }, { ownerId: callerUuid }] }] },
        select: { name: true, slug: true },
        // APPROXIMATE at extreme scale: one alias text can match multiple
        // rows (a name AND a slug, or several same-named characters), so a
        // caller whose match set exceeds this bound could see a false
        // `shadowed: false` on later aliases. Requires >MAX_LIST_ROWS
        // caller-visible name/slug collisions — far beyond current scale;
        // revisit the bound if the browse badge ever under-reports.
        take: MAX_LIST_ROWS,
      });
      for (const personality of shadowing) {
        shadowedKeys.add(personality.name.toLowerCase());
        shadowedKeys.add(personality.slug);
      }
    }

    sendContractSuccess(res, ListMyAliasesResponseSchema, {
      aliases: page.map(row => ({
        alias: row.alias,
        scope: rowScope(row),
        personality: row.personality,
        shadowed: shadowedKeys.has(row.alias.toLowerCase()),
        createdAt: row.createdAt.toISOString(),
      })),
      truncated,
    });
  };
}

// --- Handler factories + route chains ---

export const handleListPersonalityAliases = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createListHandler(deps.prisma));
export const handleAddPersonalityAlias = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createAddHandler(deps.prisma, deps.cacheInvalidationService));
export const handleRemovePersonalityAlias = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createRemoveHandler(deps.prisma, deps.cacheInvalidationService));
export const handleListMyAliases = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createMyAliasesHandler(deps.prisma));
