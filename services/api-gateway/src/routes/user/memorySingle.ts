/**
 * Single Memory Operations Handler
 * CRUD operations for individual memories
 *
 * Handlers follow the (deps: RouteDeps) => RequestHandler shape so codegen
 * can wire them up from the route manifest. The legacy
 * `createMemoryRoutes(deps)` factory in memory.ts mounts them today; the
 * generated mounts.ts will mount them once the cutover lands.
 */

import type { RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { MemoryUpdateSchema, SetMemoryLockSchema } from '@tzurot/common-types/schemas/api/memory';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { RouteDeps } from '../routeDeps.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { getParam } from '../../utils/requestParams.js';
import type { ProvisionedRequest } from '../../types.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { getDefaultPersonaId } from './memoryHelpers.js';

const logger = createLogger('user-memory-single');

const MEMORY_RESOURCE = 'Memory';
const MEMORY_ID_REQUIRED = 'Memory ID is required';

/** Include clause for personality in memory queries */
const PERSONALITY_INCLUDE = {
  personality: {
    select: { name: true, displayName: true },
  },
} as const;

interface OwnershipContext {
  prisma: PrismaClient;
  req: ProvisionedRequest;
  memoryId: string;
  res: Response;
}

/**
 * Verify memory ownership and return the memory if found
 * Sends appropriate error responses and returns null if verification fails
 */
async function verifyMemoryOwnership(
  context: OwnershipContext
): Promise<{ id: string; isLocked: boolean } | null> {
  const { prisma, req, memoryId, res } = context;

  const userId = resolveProvisionedUserId(req);

  const personaId = await getDefaultPersonaId(prisma, userId);
  if (personaId === null) {
    sendError(res, ErrorResponses.notFound(MEMORY_RESOURCE));
    return null;
  }

  const memory = await prisma.memory.findFirst({
    where: {
      id: memoryId,
      personaId,
      visibility: 'normal',
    },
  });

  if (memory === null) {
    sendError(res, ErrorResponses.notFound(MEMORY_RESOURCE));
    return null;
  }

  return memory;
}

interface MemoryResponse {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  personalityId: string;
  personalityName: string;
  isLocked: boolean;
}

/**
 * Transform database memory to API response format
 */
function transformMemory(memory: {
  id: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  personalityId: string;
  isLocked: boolean;
  personality: { name: string; displayName: string | null };
}): MemoryResponse {
  return {
    id: memory.id,
    content: memory.content,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
    personalityId: memory.personalityId,
    personalityName: memory.personality.displayName ?? memory.personality.name,
    isLocked: memory.isLocked,
  };
}

/**
 * Handler for GET /user/memory/:id
 * Get a single memory by ID
 */
export const handleGetMemory = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const memoryId = getParam(req.params.id);

    if (memoryId === undefined || memoryId.length === 0) {
      sendError(res, ErrorResponses.validationError(MEMORY_ID_REQUIRED));
      return;
    }

    const userId = resolveProvisionedUserId(req);

    const personaId = await getDefaultPersonaId(prisma, userId);
    if (personaId === null) {
      sendError(res, ErrorResponses.notFound(MEMORY_RESOURCE));
      return;
    }

    const memory = await prisma.memory.findFirst({
      where: {
        id: memoryId,
        personaId,
        visibility: 'normal',
      },
      include: PERSONALITY_INCLUDE,
    });

    if (memory === null) {
      sendError(res, ErrorResponses.notFound(MEMORY_RESOURCE));
      return;
    }

    logger.debug({ discordUserId, memoryId }, 'Single memory fetched');
    sendCustomSuccess(res, { memory: transformMemory(memory) }, StatusCodes.OK);
  });
};

/**
 * Handler for PATCH /user/memory/:id
 * Update memory content
 */
export const handleUpdateMemory = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const memoryId = getParam(req.params.id);

    if (memoryId === undefined || memoryId.length === 0) {
      sendError(res, ErrorResponses.validationError(MEMORY_ID_REQUIRED));
      return;
    }

    const parseResult = MemoryUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }

    const { content } = parseResult.data;

    const existing = await verifyMemoryOwnership({
      prisma,
      req,
      memoryId,
      res,
    });
    if (existing === null) {
      return;
    }

    // Prevent editing locked memories
    if (existing.isLocked) {
      sendError(res, ErrorResponses.forbidden('Cannot modify a locked memory'));
      return;
    }

    const memory = await prisma.memory.update({
      where: { id: memoryId },
      data: {
        content: content.trim(),
        updatedAt: new Date(),
      },
      include: PERSONALITY_INCLUDE,
    });

    logger.info({ discordUserId, memoryId }, 'Memory updated');
    sendCustomSuccess(res, { memory: transformMemory(memory) }, StatusCodes.OK);
  });
};

/**
 * Handler for PUT /user/memory/:id/lock
 * Set memory lock state explicitly. Idempotent on retry — caller passes
 * the desired state in the body rather than relying on server-side toggle
 * of the current state.
 */
export const handleSetMemoryLock = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const memoryId = getParam(req.params.id);

    if (memoryId === undefined || memoryId.length === 0) {
      sendError(res, ErrorResponses.validationError(MEMORY_ID_REQUIRED));
      return;
    }

    const parseResult = SetMemoryLockSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }
    const { locked } = parseResult.data;

    const existing = await verifyMemoryOwnership({
      prisma,
      req,
      memoryId,
      res,
    });
    if (existing === null) {
      return;
    }

    // Short-circuit when the requested state already holds — keeps the
    // retry path idempotent without an extra DB write.
    if (existing.isLocked === locked) {
      const memory = await prisma.memory.findUnique({
        where: { id: memoryId },
        include: PERSONALITY_INCLUDE,
      });
      // existing already proved the row exists; the `null` branch is unreachable
      // but TypeScript doesn't know that without the explicit guard.
      if (memory === null) {
        sendError(res, ErrorResponses.notFound('Memory'));
        return;
      }
      sendCustomSuccess(res, { memory: transformMemory(memory) }, StatusCodes.OK);
      return;
    }

    const memory = await prisma.memory.update({
      where: { id: memoryId },
      data: {
        isLocked: locked,
        updatedAt: new Date(),
      },
      include: PERSONALITY_INCLUDE,
    });

    const action = memory.isLocked ? 'locked' : 'unlocked';
    logger.info({ discordUserId, memoryId, action }, 'Memory lock state set');
    sendCustomSuccess(res, { memory: transformMemory(memory) }, StatusCodes.OK);
  });
};

/**
 * Handler for DELETE /user/memory/:id
 * Delete a memory (soft delete by setting visibility)
 */
export const handleDeleteMemory = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const memoryId = getParam(req.params.id);

    if (memoryId === undefined || memoryId.length === 0) {
      sendError(res, ErrorResponses.validationError(MEMORY_ID_REQUIRED));
      return;
    }

    const existing = await verifyMemoryOwnership({
      prisma,
      req,
      memoryId,
      res,
    });
    if (existing === null) {
      return;
    }

    // Prevent deleting locked memories
    if (existing.isLocked) {
      sendError(res, ErrorResponses.forbidden('Cannot delete a locked memory'));
      return;
    }

    // Soft delete by setting visibility to 'deleted'
    await prisma.memory.update({
      where: { id: memoryId },
      data: {
        visibility: 'deleted',
        updatedAt: new Date(),
      },
    });

    logger.info({ discordUserId, memoryId }, 'Memory deleted');
    sendCustomSuccess(res, { success: true }, StatusCodes.OK);
  });
};
