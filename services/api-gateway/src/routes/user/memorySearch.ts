/**
 * Memory Search Handler
 * Semantic and text-based search of long-term memories
 */

import type { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, Prisma, type PrismaClient } from '@tzurot/common-types';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import {
  generateEmbedding,
  formatAsVector,
  isEmbeddingServiceAvailable,
} from '../../services/EmbeddingService.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('user-memory-search');

/** Search defaults and limits */
const SEARCH_DEFAULTS = {
  limit: 10,
  maxLimit: 50,
  minSimilarity: 0.7,
  maxQueryLength: 500,
} as const;

interface SearchRequest {
  query: string;
  personalityId?: string;
  limit?: number;
  offset?: number;
  dateFrom?: string;
  dateTo?: string;
  /** Hint to skip semantic search attempt (e.g., when previous page fell back to text) */
  preferTextSearch?: boolean;
}

interface SearchResultRow {
  id: string;
  content: string;
  distance: number;
  created_at: Date;
  updated_at: Date;
  personality_name: string;
  personality_id: string;
  is_locked: boolean;
}

interface TextSearchResultRow {
  id: string;
  content: string;
  created_at: Date;
  updated_at: Date;
  personality_name: string;
  personality_id: string;
  is_locked: boolean;
}

interface SearchFilters {
  personaId: string;
  personalityId?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface SearchResponseResult {
  id: string;
  content: string;
  similarity: number | null;
  createdAt: string;
  updatedAt: string;
  personalityId: string;
  personalityName: string;
  isLocked: boolean;
}

interface SearchOutput {
  results: SearchResponseResult[];
  count: number;
  hasMore: boolean;
  searchType: 'semantic' | 'text';
}

function buildSearchConditions(filters: SearchFilters): Prisma.Sql[] {
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
  return conditions;
}

function buildTextSearchQuery(
  searchTerm: string,
  filters: SearchFilters,
  limit: number,
  offset: number
): Prisma.Sql {
  const conditions = buildSearchConditions(filters);
  conditions.push(Prisma.sql`m.content ILIKE ${`%${searchTerm}%`}`);
  const whereClause = Prisma.join(conditions, ' AND ');
  return Prisma.sql`
    SELECT m.id, m.content, m.created_at, m.updated_at, m.is_locked, m.personality_id,
      COALESCE(personality.display_name, personality.name) as personality_name
    FROM memories m JOIN personalities personality ON m.personality_id = personality.id
    WHERE ${whereClause} ORDER BY m.created_at DESC LIMIT ${limit + 1} OFFSET ${offset}`;
}

function buildSemanticSearchQuery(
  embeddingVector: string,
  filters: SearchFilters,
  maxDistance: number,
  limit: number,
  offset: number
): Prisma.Sql {
  const conditions = buildSearchConditions(filters);
  const whereClause = Prisma.join(conditions, ' AND ');
  // SECURITY: Prisma.raw() is used here for the embedding vector because Prisma.sql``
  // does not support pgvector's ::vector type casting. This is safe because:
  // 1. embeddingVector comes from formatAsVector() which outputs "[n1,n2,...]" format
  // 2. formatAsVector() uses only numeric values from the embedding service
  // 3. The embedding service returns Float32Array from the AI provider, not user input
  // User-provided query text is processed through the embedding model, never interpolated.
  return Prisma.join(
    [
      Prisma.sql`SELECT m.id, m.content, m.embedding <=> `,
      Prisma.raw(`'${embeddingVector}'::vector`),
      Prisma.sql` AS distance, m.created_at, m.updated_at, m.is_locked, m.personality_id,
        COALESCE(personality.display_name, personality.name) as personality_name
        FROM memories m JOIN personalities personality ON m.personality_id = personality.id WHERE `,
      whereClause,
      Prisma.sql` AND m.embedding <=> `,
      Prisma.raw(`'${embeddingVector}'::vector`),
      Prisma.sql` < ${maxDistance} ORDER BY distance ASC LIMIT ${limit + 1} OFFSET ${offset}`,
    ],
    ''
  );
}

function transformResults(
  results: SearchResultRow[] | TextSearchResultRow[],
  limit: number,
  isSemantic: boolean
): { responseResults: SearchResponseResult[]; hasMore: boolean } {
  const hasMore = results.length > limit;
  const paginatedResults = hasMore ? results.slice(0, limit) : results;
  const responseResults = paginatedResults.map(row => ({
    id: row.id,
    content: row.content,
    similarity: isSemantic ? Math.round((1 - (row as SearchResultRow).distance) * 100) / 100 : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    personalityId: row.personality_id,
    personalityName: row.personality_name,
    isLocked: row.is_locked,
  }));
  return { responseResults, hasMore };
}

/**
 * Execute text-based search
 */
async function executeTextSearch(
  prisma: PrismaClient,
  query: string,
  filters: SearchFilters,
  limit: number,
  offset: number
): Promise<SearchOutput> {
  const textQuery = buildTextSearchQuery(query.trim(), filters, limit, offset);
  const textResults = await prisma.$queryRaw<TextSearchResultRow[]>(textQuery);
  const { responseResults, hasMore } = transformResults(textResults, limit, false);
  return {
    results: responseResults,
    count: responseResults.length,
    hasMore,
    searchType: 'text',
  };
}

/**
 * Execute semantic search with text fallback
 * @returns SearchOutput on success, or error object if embedding generation failed
 */
async function executeSemanticSearchWithFallback(
  prisma: PrismaClient,
  query: string,
  filters: SearchFilters,
  limit: number,
  offset: number
): Promise<SearchOutput | { error: 'embedding_failed' | 'embedding_unavailable' }> {
  let embedding: number[] | null;
  try {
    embedding = await generateEmbedding(query);
    if (embedding === null) {
      return { error: 'embedding_unavailable' };
    }
  } catch (error) {
    logger.error(
      { err: error, query: query.substring(0, 50) },
      '[Memory] Embedding generation failed'
    );
    return { error: 'embedding_failed' };
  }

  const semanticQuery = buildSemanticSearchQuery(
    formatAsVector(embedding),
    filters,
    1 - SEARCH_DEFAULTS.minSimilarity,
    limit,
    offset
  );
  const semanticResults = await prisma.$queryRaw<SearchResultRow[]>(semanticQuery);

  if (semanticResults.length > 0) {
    const { responseResults, hasMore } = transformResults(semanticResults, limit, true);
    return {
      results: responseResults,
      count: responseResults.length,
      hasMore,
      searchType: 'semantic',
    };
  }

  // Fall back to text search
  return executeTextSearch(prisma, query, filters, limit, offset);
}

/** Handler for POST /user/memory/search */
export async function handleSearch(
  prisma: PrismaClient,
  getUserByDiscordId: (id: string, res: Response) => Promise<{ id: string } | null>,
  getDefaultPersonaId: (prisma: PrismaClient, userId: string) => Promise<string | null>,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  if (!isEmbeddingServiceAvailable()) {
    sendError(res, ErrorResponses.serviceUnavailable('Memory search is not configured'));
    return;
  }

  const discordUserId = req.userId;
  const { query, personalityId, limit, offset, dateFrom, dateTo, preferTextSearch } =
    req.body as SearchRequest;

  if (query === undefined || query.trim().length === 0) {
    sendError(res, ErrorResponses.validationError('query is required'));
    return;
  }
  if (query.length > SEARCH_DEFAULTS.maxQueryLength) {
    sendError(
      res,
      ErrorResponses.validationError(
        `query exceeds maximum length of ${SEARCH_DEFAULTS.maxQueryLength} characters`
      )
    );
    return;
  }

  const effectiveLimit = Math.min(
    Math.max(1, limit ?? SEARCH_DEFAULTS.limit),
    SEARCH_DEFAULTS.maxLimit
  );
  const effectiveOffset = Math.max(0, offset ?? 0);

  const user = await getUserByDiscordId(discordUserId, res);
  if (!user) {
    return;
  }

  const personaId = await getDefaultPersonaId(prisma, user.id);
  if (personaId === null) {
    sendCustomSuccess(res, { results: [], count: 0, hasMore: false }, StatusCodes.OK);
    return;
  }

  const filters: SearchFilters = { personaId, personalityId, dateFrom, dateTo };

  let output: SearchOutput;

  // Skip semantic search if client hints that text search is preferred (e.g., pagination after fallback)
  if (preferTextSearch === true) {
    output = await executeTextSearch(prisma, query, filters, effectiveLimit, effectiveOffset);
  } else {
    const result = await executeSemanticSearchWithFallback(
      prisma,
      query,
      filters,
      effectiveLimit,
      effectiveOffset
    );

    if ('error' in result) {
      if (result.error === 'embedding_unavailable') {
        sendError(res, ErrorResponses.serviceUnavailable('Failed to generate search embedding'));
      } else {
        sendError(res, ErrorResponses.internalError('Search embedding generation failed'));
      }
      return;
    }

    output = result;
  }

  logger.debug(
    {
      discordUserId,
      queryLength: query.length,
      personalityId,
      resultCount: output.count,
      searchType: output.searchType,
    },
    `[Memory] Search completed${output.searchType === 'text' ? ' (text fallback)' : ''}`
  );
  sendCustomSuccess(res, output, StatusCodes.OK);
}
