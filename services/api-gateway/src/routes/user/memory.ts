/**
 * User Memory Routes
 * LTM (Long-Term Memory) management endpoints
 *
 * GET /user/memory/stats - Get memory statistics for a personality
 * GET /user/memory/focus - Get focus mode status
 * POST /user/memory/focus - Enable/disable focus mode
 * POST /user/memory/search - Semantic search of memories
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  Prisma,
  type PrismaClient,
  generateUserPersonalityConfigUuid,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import {
  generateEmbedding,
  formatAsVector,
  isEmbeddingServiceAvailable,
} from '../../services/EmbeddingService.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('user-memory');

/** Search defaults and limits */
const SEARCH_DEFAULTS = {
  limit: 10,
  maxLimit: 50,
  minSimilarity: 0.7, // Lower threshold for search (vs 0.85 for automatic retrieval)
} as const;

interface FocusModeRequest {
  personalityId: string;
  enabled: boolean;
}

interface SearchRequest {
  query: string;
  personalityId?: string;
  limit?: number;
  offset?: number;
  dateFrom?: string;
  dateTo?: string;
}

interface SearchResultRow {
  id: string;
  content: string;
  distance: number;
  created_at: Date;
  personality_name: string;
  personality_id: string;
  is_locked: boolean;
}

/**
 * Get user's default persona ID
 */
async function getDefaultPersonaId(prisma: PrismaClient, userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { defaultPersonaId: true },
  });
  return user?.defaultPersonaId ?? null;
}

/**
 * Validate and get user from Discord ID
 */
async function getUserByDiscordId(
  prisma: PrismaClient,
  discordUserId: string,
  res: Response
): Promise<{ id: string } | null> {
  const user = await prisma.user.findUnique({
    where: { discordId: discordUserId },
    select: { id: true },
  });

  if (!user) {
    sendError(res, ErrorResponses.notFound('User not found'));
    return null;
  }

  return user;
}

/**
 * Validate and get personality by ID
 */
async function getPersonalityById(
  prisma: PrismaClient,
  personalityId: string,
  res: Response
): Promise<{ id: string; name: string } | null> {
  const personality = await prisma.personality.findUnique({
    where: { id: personalityId },
    select: { id: true, name: true },
  });

  if (!personality) {
    sendError(res, ErrorResponses.notFound('Personality not found'));
    return null;
  }

  return personality;
}

/**
 * Handler for GET /user/memory/stats
 */
async function handleGetStats(
  prisma: PrismaClient,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const { personalityId } = req.query as { personalityId?: string };

  if (personalityId === undefined || personalityId === '') {
    sendError(res, ErrorResponses.validationError('personalityId query parameter is required'));
    return;
  }

  const user = await getUserByDiscordId(prisma, discordUserId, res);
  if (!user) {
    return;
  }

  const personality = await getPersonalityById(prisma, personalityId, res);
  if (!personality) {
    return;
  }

  // Get user's persona config for this personality
  const config = await prisma.userPersonalityConfig.findUnique({
    where: {
      userId_personalityId: {
        userId: user.id,
        personalityId,
      },
    },
    select: {
      personaId: true,
      focusModeEnabled: true,
    },
  });

  const personaId = config?.personaId ?? (await getDefaultPersonaId(prisma, user.id));

  if (personaId === null || personaId === undefined) {
    sendCustomSuccess(
      res,
      {
        personalityId,
        personalityName: personality.name,
        personaId: null,
        totalCount: 0,
        lockedCount: 0,
        oldestMemory: null,
        newestMemory: null,
        focusModeEnabled: false,
      },
      StatusCodes.OK
    );
    return;
  }

  // Query only normal visibility memories (hidden/archived filtering coming in future iteration)
  // Note: Using parallel queries instead of aggregate because Prisma aggregate doesn't support
  // conditional counts (locked memories). Four parallel queries ≈ same latency as 2 aggregate calls.
  const [totalCount, lockedCount, oldestMemory, newestMemory] = await Promise.all([
    prisma.memory.count({
      where: { personaId, personalityId, visibility: 'normal' },
    }),
    prisma.memory.count({
      where: { personaId, personalityId, visibility: 'normal', isLocked: true },
    }),
    prisma.memory.findFirst({
      where: { personaId, personalityId, visibility: 'normal' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    prisma.memory.findFirst({
      where: { personaId, personalityId, visibility: 'normal' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);

  logger.debug(
    { discordUserId, personalityId, personaId: personaId.substring(0, 8), totalCount },
    '[Memory] Stats retrieved'
  );

  sendCustomSuccess(
    res,
    {
      personalityId,
      personalityName: personality.name,
      personaId,
      totalCount,
      lockedCount,
      oldestMemory: oldestMemory?.createdAt?.toISOString() ?? null,
      newestMemory: newestMemory?.createdAt?.toISOString() ?? null,
      focusModeEnabled: config?.focusModeEnabled ?? false,
    },
    StatusCodes.OK
  );
}

/**
 * Handler for GET /user/memory/focus
 */
async function handleGetFocus(
  prisma: PrismaClient,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const { personalityId } = req.query as { personalityId?: string };

  if (personalityId === undefined || personalityId === '') {
    sendError(res, ErrorResponses.validationError('personalityId query parameter is required'));
    return;
  }

  const user = await getUserByDiscordId(prisma, discordUserId, res);
  if (!user) {
    return;
  }

  const config = await prisma.userPersonalityConfig.findUnique({
    where: {
      userId_personalityId: {
        userId: user.id,
        personalityId,
      },
    },
    select: { focusModeEnabled: true },
  });

  sendCustomSuccess(
    res,
    {
      personalityId,
      focusModeEnabled: config?.focusModeEnabled ?? false,
    },
    StatusCodes.OK
  );
}

/**
 * Handler for POST /user/memory/focus
 */
async function handleSetFocus(
  prisma: PrismaClient,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const { personalityId, enabled } = req.body as FocusModeRequest;

  if (personalityId === undefined || personalityId === '') {
    sendError(res, ErrorResponses.validationError('personalityId is required'));
    return;
  }
  if (typeof enabled !== 'boolean') {
    sendError(res, ErrorResponses.validationError('enabled must be a boolean'));
    return;
  }

  const user = await getUserByDiscordId(prisma, discordUserId, res);
  if (!user) {
    return;
  }

  const personality = await getPersonalityById(prisma, personalityId, res);
  if (!personality) {
    return;
  }

  await prisma.userPersonalityConfig.upsert({
    where: {
      userId_personalityId: {
        userId: user.id,
        personalityId,
      },
    },
    update: {
      focusModeEnabled: enabled,
    },
    create: {
      id: generateUserPersonalityConfigUuid(user.id, personalityId),
      userId: user.id,
      personalityId,
      focusModeEnabled: enabled,
    },
  });

  logger.info(
    { discordUserId, personalityId, enabled },
    `[Memory] Focus mode ${enabled ? 'enabled' : 'disabled'}`
  );

  sendCustomSuccess(
    res,
    {
      personalityId,
      personalityName: personality.name,
      focusModeEnabled: enabled,
      message: enabled
        ? 'Focus mode enabled. Long-term memories will not be retrieved during conversations.'
        : 'Focus mode disabled. Long-term memories will be retrieved during conversations.',
    },
    StatusCodes.OK
  );
}

interface SearchFilters {
  personaId: string;
  personalityId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Build pgvector similarity search SQL query
 */
function buildSearchQuery(
  embeddingVector: string,
  filters: SearchFilters,
  maxDistance: number,
  limit: number,
  offset: number
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`m.persona_id = ${filters.personaId}::uuid`,
    Prisma.sql`m.visibility = 'normal'`,
  ];

  if (filters.personalityId !== undefined && filters.personalityId.length > 0) {
    conditions.push(Prisma.sql`m.personality_id = ${filters.personalityId}::uuid`);
  }
  if (filters.dateFrom !== undefined && filters.dateFrom.length > 0) {
    conditions.push(Prisma.sql`m.created_at >= ${filters.dateFrom}::timestamptz`);
  }
  if (filters.dateTo !== undefined && filters.dateTo.length > 0) {
    conditions.push(Prisma.sql`m.created_at <= ${filters.dateTo}::timestamptz`);
  }

  const whereClause = Prisma.join(conditions, ' AND ');

  // Note: Using Prisma.raw() for embedding vector is safe because it's constructed
  // from numeric array only (validated by generateEmbedding)
  return Prisma.join(
    [
      Prisma.sql`SELECT m.id, m.content, m.embedding <=> `,
      Prisma.raw(`'${embeddingVector}'::vector`),
      Prisma.sql` AS distance, m.created_at, m.is_locked, m.personality_id,
        COALESCE(personality.display_name, personality.name) as personality_name
        FROM memories m JOIN personalities personality ON m.personality_id = personality.id
        WHERE `,
      whereClause,
      Prisma.sql` AND m.embedding <=> `,
      Prisma.raw(`'${embeddingVector}'::vector`),
      Prisma.sql` < ${maxDistance} ORDER BY distance ASC LIMIT ${limit + 1} OFFSET ${offset}`,
    ],
    ''
  );
}

/**
 * Transform search results to API response format
 */
interface SearchResponseResult {
  id: string;
  content: string;
  similarity: number;
  createdAt: string;
  personalityId: string;
  personalityName: string;
  isLocked: boolean;
}

function transformSearchResults(
  results: SearchResultRow[],
  limit: number
): { responseResults: SearchResponseResult[]; hasMore: boolean } {
  const hasMore = results.length > limit;
  const paginatedResults = hasMore ? results.slice(0, limit) : results;

  const responseResults = paginatedResults.map(row => ({
    id: row.id,
    content: row.content,
    similarity: Math.round((1 - row.distance) * 100) / 100,
    createdAt: row.created_at.toISOString(),
    personalityId: row.personality_id,
    personalityName: row.personality_name,
    isLocked: row.is_locked,
  }));

  return { responseResults, hasMore };
}

/**
 * Handler for POST /user/memory/search
 */
async function handleSearch(
  prisma: PrismaClient,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  if (!isEmbeddingServiceAvailable()) {
    sendError(res, ErrorResponses.serviceUnavailable('Memory search is not configured'));
    return;
  }

  const discordUserId = req.userId;
  const { query, personalityId, limit, offset, dateFrom, dateTo } = req.body as SearchRequest;

  if (query === undefined || query.trim().length === 0) {
    sendError(res, ErrorResponses.validationError('query is required'));
    return;
  }

  const effectiveLimit = Math.min(
    Math.max(1, limit ?? SEARCH_DEFAULTS.limit),
    SEARCH_DEFAULTS.maxLimit
  );
  const effectiveOffset = Math.max(0, offset ?? 0);

  const user = await getUserByDiscordId(prisma, discordUserId, res);
  if (!user) {
    return;
  }

  const personaId = await getDefaultPersonaId(prisma, user.id);
  if (personaId === null) {
    sendCustomSuccess(res, { results: [], total: 0, hasMore: false }, StatusCodes.OK);
    return;
  }

  let embedding: number[] | null;
  try {
    embedding = await generateEmbedding(query);
    if (embedding === null) {
      sendError(res, ErrorResponses.serviceUnavailable('Failed to generate search embedding'));
      return;
    }
  } catch (error) {
    logger.error(
      { err: error, query: query.substring(0, 50) },
      '[Memory] Embedding generation failed'
    );
    sendError(res, ErrorResponses.internalError('Search embedding generation failed'));
    return;
  }

  const searchQuery = buildSearchQuery(
    formatAsVector(embedding),
    { personaId, personalityId, dateFrom, dateTo },
    1 - SEARCH_DEFAULTS.minSimilarity,
    effectiveLimit,
    effectiveOffset
  );

  const results = await prisma.$queryRaw<SearchResultRow[]>(searchQuery);
  const { responseResults, hasMore } = transformSearchResults(results, effectiveLimit);

  logger.debug(
    {
      discordUserId,
      queryLength: query.length,
      personalityId,
      resultCount: responseResults.length,
      hasMore,
    },
    '[Memory] Search completed'
  );

  sendCustomSuccess(
    res,
    { results: responseResults, total: responseResults.length + effectiveOffset, hasMore },
    StatusCodes.OK
  );
}

export function createMemoryRoutes(prisma: PrismaClient): Router {
  const router = Router();

  router.get(
    '/stats',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) => handleGetStats(prisma, req, res))
  );

  router.get(
    '/focus',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) => handleGetFocus(prisma, req, res))
  );

  router.post(
    '/focus',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) => handleSetFocus(prisma, req, res))
  );

  router.post(
    '/search',
    requireUserAuth(),
    asyncHandler((req: AuthenticatedRequest, res: Response) => handleSearch(prisma, req, res))
  );

  return router;
}
