/**
 * Memory List Handler
 * Paginated list of long-term memories for browsing
 */

import type { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, type PrismaClient } from '@tzurot/common-types';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';
import type { AuthenticatedRequest } from '../../types.js';
import { getUserByDiscordId, getDefaultPersonaId } from './memoryHelpers.js';

const logger = createLogger('user-memory-list');

/** List defaults and limits */
const LIST_DEFAULTS = {
  limit: 15,
  maxLimit: 50,
} as const;

/** Valid sort fields */
type SortField = 'createdAt' | 'updatedAt';
type SortOrder = 'asc' | 'desc';

interface ListQuery {
  personalityId?: string;
  limit?: string;
  offset?: string;
  sort?: string;
  order?: string;
}

interface MemoryListItem {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  personalityId: string;
  personalityName: string;
  isLocked: boolean;
}

interface ListResponse {
  memories: MemoryListItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Handler for GET /user/memory/list
 *
 * Query parameters:
 * - personalityId: Filter by personality (optional)
 * - limit: Number of items per page (default 15, max 50)
 * - offset: Number of items to skip (default 0)
 * - sort: Sort field (createdAt, updatedAt) (default: createdAt)
 * - order: Sort order (asc, desc) (default: desc)
 */
export async function handleList(
  prisma: PrismaClient,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const { personalityId, limit, offset, sort, order } = req.query as ListQuery;

  // Parse and validate pagination parameters
  const effectiveLimit = Math.min(
    Math.max(1, parseInt(limit ?? '', 10) || LIST_DEFAULTS.limit),
    LIST_DEFAULTS.maxLimit
  );
  const effectiveOffset = Math.max(0, parseInt(offset ?? '', 10) || 0);

  // Parse and validate sort parameters
  const validSortFields: SortField[] = ['createdAt', 'updatedAt'];
  const effectiveSort: SortField = validSortFields.includes(sort as SortField)
    ? (sort as SortField)
    : 'createdAt';
  const effectiveOrder: SortOrder = order === 'asc' ? 'asc' : 'desc';

  // Get user
  const user = await getUserByDiscordId(prisma, discordUserId, res);
  if (!user) {
    return;
  }

  // Get persona
  const personaId = await getDefaultPersonaId(prisma, user.id);
  if (personaId === null) {
    sendCustomSuccess(
      res,
      {
        memories: [],
        total: 0,
        limit: effectiveLimit,
        offset: effectiveOffset,
        hasMore: false,
      } satisfies ListResponse,
      StatusCodes.OK
    );
    return;
  }

  // Build where clause
  const whereClause = {
    personaId,
    visibility: 'normal',
    ...(personalityId !== undefined && personalityId.length > 0 ? { personalityId } : {}),
  };

  // Get total count and memories in parallel
  const [total, memories] = await Promise.all([
    prisma.memory.count({ where: whereClause }),
    prisma.memory.findMany({
      where: whereClause,
      orderBy: { [effectiveSort]: effectiveOrder },
      skip: effectiveOffset,
      take: effectiveLimit,
      select: {
        id: true,
        content: true,
        createdAt: true,
        updatedAt: true,
        personalityId: true,
        isLocked: true,
        personality: {
          select: {
            name: true,
            displayName: true,
          },
        },
      },
    }),
  ]);

  // Transform to response format
  const memoryList: MemoryListItem[] = memories.map(m => ({
    id: m.id,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    personalityId: m.personalityId,
    personalityName: m.personality?.displayName ?? m.personality?.name ?? 'Unknown',
    isLocked: m.isLocked,
  }));

  const hasMore = effectiveOffset + memoryList.length < total;

  logger.debug(
    {
      discordUserId,
      personalityId,
      total,
      returned: memoryList.length,
      offset: effectiveOffset,
      hasMore,
    },
    '[Memory] List retrieved'
  );

  sendCustomSuccess(
    res,
    {
      memories: memoryList,
      total,
      limit: effectiveLimit,
      offset: effectiveOffset,
      hasMore,
    } satisfies ListResponse,
    StatusCodes.OK
  );
}
