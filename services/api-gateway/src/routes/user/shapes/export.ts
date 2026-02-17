/**
 * Shapes.inc Export Route
 *
 * POST /user/shapes/export - Fetch full character data from shapes.inc
 *
 * Returns the complete character data (config, memories, stories, user
 * personalization) as a JSON payload that the bot-client can send as
 * a Discord file attachment.
 *
 * This route makes multiple API calls to shapes.inc (config, paginated
 * memories, stories, user data) so it has a longer timeout.
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  decryptApiKey,
  type PrismaClient,
  CREDENTIAL_SERVICES,
  CREDENTIAL_TYPES,
  SHAPES_BASE_URL,
  SHAPES_USER_AGENT,
  type ShapesIncPersonalityConfig,
  type ShapesIncMemory,
  type ShapesIncStory,
  type ShapesIncUserPersonalization,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../../types.js';

const logger = createLogger('shapes-export');

const EXPORT_TOTAL_TIMEOUT_MS = 300_000; // 5 minutes for multi-page fetch
const DELAY_BETWEEN_REQUESTS_MS = 1000;
const MEMORIES_PER_PAGE = 20;
const MAX_MEMORY_PAGES = 500; // Safety cap: 10,000 memories at 20/page

// ============================================================================
// Shapes.inc API helpers (lightweight — no class, just functions)
// ============================================================================

interface FetchContext {
  cookie: string;
  signal: AbortSignal;
}

async function shapesApiFetch<T>(url: string, ctx: FetchContext): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Cookie: ctx.cookie,
      'User-Agent': SHAPES_USER_AGENT,
      Accept: 'application/json',
    },
    signal: ctx.signal,
  });

  // Detect redirect to login page (shapes.inc may redirect instead of returning 401)
  const wasRedirected = response.url !== url;

  if (!response.ok || wasRedirected) {
    if (wasRedirected) {
      logger.warn({ requestedUrl: url, finalUrl: response.url }, '[Shapes] Request was redirected');
    }
    if (response.status === 401 || response.status === 403 || wasRedirected) {
      throw new ShapesExportAuthError('Session cookie expired');
    }
    if (response.status === 404) {
      throw new ShapesExportNotFoundError('Shape not found');
    }
    throw new ShapesExportError(`shapes.inc returned ${String(response.status)}`);
  }

  return (await response.json()) as T;
}

function delay(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS_MS));
}

class ShapesExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShapesExportError';
  }
}

class ShapesExportAuthError extends ShapesExportError {
  constructor(message: string) {
    super(message);
    this.name = 'ShapesExportAuthError';
  }
}

class ShapesExportNotFoundError extends ShapesExportError {
  constructor(message: string) {
    super(message);
    this.name = 'ShapesExportNotFoundError';
  }
}

interface MemoryPage {
  data: ShapesIncMemory[];
  pagination: { has_next: boolean; page: number };
}

async function fetchAllMemories(shapeId: string, ctx: FetchContext): Promise<ShapesIncMemory[]> {
  const allMemories: ShapesIncMemory[] = [];
  let page = 1;
  let hasNext = true;

  while (hasNext && page <= MAX_MEMORY_PAGES) {
    if (page > 1) {
      await delay();
    }

    const result = await shapesApiFetch<MemoryPage | ShapesIncMemory[]>(
      `${SHAPES_BASE_URL}/api/memory/${encodeURIComponent(shapeId)}?page=${String(page)}&limit=${String(MEMORIES_PER_PAGE)}`,
      ctx
    );

    // Handle both paginated response { data, pagination } and plain array response
    if (Array.isArray(result)) {
      logger.debug(
        { shapeId, page, count: result.length },
        '[Shapes] Memory endpoint returned array'
      );
      allMemories.push(...result);
      hasNext = false; // No pagination info — assume single page
    } else if (result !== null && typeof result === 'object' && Array.isArray(result.data)) {
      allMemories.push(...result.data);
      hasNext = result.pagination?.has_next === true;
    } else {
      logger.warn(
        { shapeId, page, responseKeys: Object.keys(result as object) },
        '[Shapes] Unexpected memory response shape — skipping'
      );
      hasNext = false;
    }

    page++;
  }

  return allMemories;
}

// ============================================================================
// Data fetching orchestrator
// ============================================================================

interface ShapeExportData {
  config: ShapesIncPersonalityConfig;
  memories: ShapesIncMemory[];
  stories: ShapesIncStory[];
  userPersonalization: ShapesIncUserPersonalization | null;
}

async function fetchShapeExportData(slug: string, ctx: FetchContext): Promise<ShapeExportData> {
  const config = await shapesApiFetch<ShapesIncPersonalityConfig>(
    `${SHAPES_BASE_URL}/api/shapes/username/${encodeURIComponent(slug)}`,
    ctx
  );

  await delay();
  const memories = await fetchAllMemories(config.id, ctx);

  await delay();
  const stories = await shapesApiFetch<ShapesIncStory[]>(
    `${SHAPES_BASE_URL}/api/shapes/${encodeURIComponent(config.id)}/story`,
    ctx
  );

  await delay();
  let userPersonalization: ShapesIncUserPersonalization | null = null;
  try {
    userPersonalization = await shapesApiFetch<ShapesIncUserPersonalization>(
      `${SHAPES_BASE_URL}/api/shapes/${encodeURIComponent(config.id)}/user`,
      ctx
    );
  } catch (error) {
    if (error instanceof ShapesExportNotFoundError) {
      logger.debug({ slug }, '[Shapes] No user personalization found');
    } else {
      throw error;
    }
  }

  return { config, memories, stories, userPersonalization };
}

// ============================================================================
// Route handler
// ============================================================================

function createExportHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const { slug } = req.body as { slug?: string };

    if (slug === undefined || typeof slug !== 'string' || slug.trim().length === 0) {
      return sendError(res, ErrorResponses.validationError('slug is required'));
    }

    const normalizedSlug = slug.trim().toLowerCase();

    // Resolve session cookie
    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    if (user === null) {
      return sendError(res, ErrorResponses.unauthorized('No shapes.inc credentials found'));
    }

    const credential = await prisma.userCredential.findFirst({
      where: {
        userId: user.id,
        service: CREDENTIAL_SERVICES.SHAPES_INC,
        credentialType: CREDENTIAL_TYPES.SESSION_COOKIE,
      },
    });

    if (credential === null) {
      return sendError(res, ErrorResponses.unauthorized('No shapes.inc credentials found'));
    }

    const sessionCookie = decryptApiKey({
      iv: credential.iv,
      content: credential.content,
      tag: credential.tag,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXPORT_TOTAL_TIMEOUT_MS);

    try {
      const data = await fetchShapeExportData(normalizedSlug, {
        cookie: sessionCookie,
        signal: controller.signal,
      });

      await prisma.userCredential.updateMany({
        where: {
          userId: user.id,
          service: CREDENTIAL_SERVICES.SHAPES_INC,
          credentialType: CREDENTIAL_TYPES.SESSION_COOKIE,
        },
        data: { lastUsedAt: new Date() },
      });

      logger.info(
        { discordUserId, slug: normalizedSlug, memoriesCount: data.memories.length },
        '[Shapes] Export data fetched'
      );

      sendCustomSuccess(
        res,
        {
          exportedAt: new Date().toISOString(),
          sourceSlug: normalizedSlug,
          ...data,
          stats: {
            memoriesCount: data.memories.length,
            storiesCount: data.stories.length,
            hasUserPersonalization: data.userPersonalization !== null,
          },
        },
        StatusCodes.OK
      );
    } catch (error) {
      if (error instanceof ShapesExportAuthError) {
        return sendError(
          res,
          ErrorResponses.unauthorized('Session cookie expired. Re-authenticate with /shapes auth.')
        );
      }
      if (error instanceof ShapesExportNotFoundError) {
        return sendError(
          res,
          ErrorResponses.notFound(`Shape '${normalizedSlug}' not found on shapes.inc`)
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}

export function createShapesExportRoutes(prisma: PrismaClient): Router {
  const router = Router();

  router.post('/', requireUserAuth(), asyncHandler(createExportHandler(prisma)));

  return router;
}
