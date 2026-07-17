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
 *  - exact-match against any personality NAME or SLUG → rejected: the
 *    resolver checks names/slugs before aliases, so such an alias would be
 *    permanently shadowed (dead on arrival).
 *  - existing alias → 409 via the global unique constraint (P2002).
 * Alias ids are deterministic over the lowercased alias, so the same alias
 * created independently in both environments converges under db-sync.
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
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
import { sendCustomSuccess, sendError } from '../../../utils/responseHelpers.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { ProvisionedRequest } from '../../../types.js';
import { getParam } from '../../../utils/requestParams.js';
import { canUserEditPersonality } from './helpers.js';
import type { RouteDeps } from '../../routeDeps.js';

const logger = createLogger('user-personality-aliases');

/** Ledger-bounded read: aliases per character are single digits in practice. */
const MAX_ALIASES = 100;

interface EditablePersonality {
  id: string;
  slug: string;
}

/**
 * Resolve the personality by slug and require edit permission.
 * Returns null after sending the error response.
 */
async function requireEditablePersonality(
  prisma: PrismaClient,
  req: ProvisionedRequest,
  res: Response
): Promise<EditablePersonality | null> {
  const slug = getParam(req.params.slug);
  const personality = await prisma.personality.findUnique({
    where: { slug },
    select: { id: true, slug: true },
  });
  if (personality === null) {
    sendError(res, ErrorResponses.notFound('Personality'));
    return null;
  }

  const userId = resolveProvisionedUserId(req);
  const canEdit = await canUserEditPersonality(prisma, userId, personality.id, req.userId);
  if (!canEdit) {
    sendError(res, ErrorResponses.unauthorized('You cannot manage aliases for this character'));
    return null;
  }
  return personality;
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

    const parsed = ListPersonalityAliasesResponseSchema.parse({
      aliases: rows.map(row => ({ alias: row.alias, createdAt: row.createdAt.toISOString() })),
    });
    sendCustomSuccess(res, parsed, StatusCodes.OK);
  };
}

// --- POST /user/personality/:slug/aliases ---

function createAddHandler(prisma: PrismaClient) {
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

    // Shadow check: the resolver matches names/slugs BEFORE aliases, so an
    // alias equal to any existing name or slug could never fire.
    const shadowing = await prisma.personality.findFirst({
      where: {
        OR: [{ name: { equals: alias, mode: 'insensitive' } }, { slug: alias.toLowerCase() }],
      },
      select: { slug: true },
    });
    if (shadowing !== null) {
      return sendError(
        res,
        ErrorResponses.validationError(
          `"${alias}" matches an existing character's name or slug (${shadowing.slug}) — an alias here would never resolve`
        )
      );
    }

    try {
      const row = await prisma.personalityAlias.create({
        data: {
          id: generatePersonalityAliasUuid(alias),
          alias,
          personalityId: personality.id,
        },
      });
      logger.info({ slug: personality.slug, aliasId: row.id }, 'Alias added');
      const parsed = AddPersonalityAliasResponseSchema.parse({
        alias: { alias: row.alias, createdAt: row.createdAt.toISOString() },
      });
      return sendCustomSuccess(res, parsed, StatusCodes.CREATED);
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

function createRemoveHandler(prisma: PrismaClient) {
  return async (req: ProvisionedRequest, res: Response) => {
    const personality = await requireEditablePersonality(prisma, req, res);
    if (personality === null) {
      return;
    }
    const alias = getParam(req.params.alias);

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
    const parsed = RemovePersonalityAliasResponseSchema.parse({ removedAlias: row.alias });
    sendCustomSuccess(res, parsed, StatusCodes.OK);
  };
}

// --- Handler factories + route chains ---

export const handleListPersonalityAliases = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createListHandler(deps.prisma));
export const handleAddPersonalityAlias = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createAddHandler(deps.prisma));
export const handleRemovePersonalityAlias = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createRemoveHandler(deps.prisma));
