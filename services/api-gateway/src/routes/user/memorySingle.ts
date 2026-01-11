/**
 * Single Memory Operations Handler
 * CRUD operations for individual memories
 */

import type { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, type PrismaClient } from '@tzurot/common-types';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('user-memory-single');

/** Maximum content length for memory updates */
const MAX_CONTENT_LENGTH = 2000;

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
export async function handleGetMemory(
  prisma: PrismaClient,
  getUserByDiscordId: (id: string, res: Response) => Promise<{ id: string } | null>,
  getDefaultPersonaId: (prisma: PrismaClient, userId: string) => Promise<string | null>,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const memoryId = req.params.id;

  if (memoryId === undefined || memoryId.length === 0) {
    sendError(res, ErrorResponses.validationError('Memory ID is required'));
    return;
  }

  const user = await getUserByDiscordId(discordUserId, res);
  if (!user) {
    return;
  }

  const personaId = await getDefaultPersonaId(prisma, user.id);
  if (personaId === null) {
    sendError(res, ErrorResponses.notFound('Memory not found'));
    return;
  }

  const memory = await prisma.memory.findFirst({
    where: {
      id: memoryId,
      personaId,
      visibility: 'normal',
    },
    include: {
      personality: {
        select: { name: true, displayName: true },
      },
    },
  });

  if (memory === null) {
    sendError(res, ErrorResponses.notFound('Memory not found'));
    return;
  }

  logger.debug({ discordUserId, memoryId }, '[Memory] Single memory fetched');
  sendCustomSuccess(res, { memory: transformMemory(memory) }, StatusCodes.OK);
}

/**
 * Handler for PATCH /user/memory/:id
 * Update memory content
 */
export async function handleUpdateMemory(
  prisma: PrismaClient,
  getUserByDiscordId: (id: string, res: Response) => Promise<{ id: string } | null>,
  getDefaultPersonaId: (prisma: PrismaClient, userId: string) => Promise<string | null>,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const memoryId = req.params.id;
  const { content } = req.body as { content?: string };

  if (memoryId === undefined || memoryId.length === 0) {
    sendError(res, ErrorResponses.validationError('Memory ID is required'));
    return;
  }

  if (content === undefined || content.trim().length === 0) {
    sendError(res, ErrorResponses.validationError('Content is required'));
    return;
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    sendError(
      res,
      ErrorResponses.validationError(`Content exceeds maximum length of ${MAX_CONTENT_LENGTH}`)
    );
    return;
  }

  const user = await getUserByDiscordId(discordUserId, res);
  if (!user) {
    return;
  }

  const personaId = await getDefaultPersonaId(prisma, user.id);
  if (personaId === null) {
    sendError(res, ErrorResponses.notFound('Memory not found'));
    return;
  }

  // Verify ownership before update
  const existing = await prisma.memory.findFirst({
    where: {
      id: memoryId,
      personaId,
      visibility: 'normal',
    },
  });

  if (existing === null) {
    sendError(res, ErrorResponses.notFound('Memory not found'));
    return;
  }

  const memory = await prisma.memory.update({
    where: { id: memoryId },
    data: {
      content: content.trim(),
      updatedAt: new Date(),
    },
    include: {
      personality: {
        select: { name: true, displayName: true },
      },
    },
  });

  logger.info({ discordUserId, memoryId }, '[Memory] Memory updated');
  sendCustomSuccess(res, { memory: transformMemory(memory) }, StatusCodes.OK);
}

/**
 * Handler for POST /user/memory/:id/lock
 * Toggle memory lock status
 */
export async function handleToggleLock(
  prisma: PrismaClient,
  getUserByDiscordId: (id: string, res: Response) => Promise<{ id: string } | null>,
  getDefaultPersonaId: (prisma: PrismaClient, userId: string) => Promise<string | null>,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const memoryId = req.params.id;

  if (memoryId === undefined || memoryId.length === 0) {
    sendError(res, ErrorResponses.validationError('Memory ID is required'));
    return;
  }

  const user = await getUserByDiscordId(discordUserId, res);
  if (!user) {
    return;
  }

  const personaId = await getDefaultPersonaId(prisma, user.id);
  if (personaId === null) {
    sendError(res, ErrorResponses.notFound('Memory not found'));
    return;
  }

  // Verify ownership before update
  const existing = await prisma.memory.findFirst({
    where: {
      id: memoryId,
      personaId,
      visibility: 'normal',
    },
  });

  if (existing === null) {
    sendError(res, ErrorResponses.notFound('Memory not found'));
    return;
  }

  const memory = await prisma.memory.update({
    where: { id: memoryId },
    data: {
      isLocked: !existing.isLocked,
      updatedAt: new Date(),
    },
    include: {
      personality: {
        select: { name: true, displayName: true },
      },
    },
  });

  const action = memory.isLocked ? 'locked' : 'unlocked';
  logger.info({ discordUserId, memoryId, action }, '[Memory] Memory lock toggled');
  sendCustomSuccess(res, { memory: transformMemory(memory) }, StatusCodes.OK);
}

/**
 * Handler for DELETE /user/memory/:id
 * Delete a memory (soft delete by setting visibility)
 */
export async function handleDeleteMemory(
  prisma: PrismaClient,
  getUserByDiscordId: (id: string, res: Response) => Promise<{ id: string } | null>,
  getDefaultPersonaId: (prisma: PrismaClient, userId: string) => Promise<string | null>,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const memoryId = req.params.id;

  if (memoryId === undefined || memoryId.length === 0) {
    sendError(res, ErrorResponses.validationError('Memory ID is required'));
    return;
  }

  const user = await getUserByDiscordId(discordUserId, res);
  if (!user) {
    return;
  }

  const personaId = await getDefaultPersonaId(prisma, user.id);
  if (personaId === null) {
    sendError(res, ErrorResponses.notFound('Memory not found'));
    return;
  }

  // Verify ownership before delete
  const existing = await prisma.memory.findFirst({
    where: {
      id: memoryId,
      personaId,
      visibility: 'normal',
    },
  });

  if (existing === null) {
    sendError(res, ErrorResponses.notFound('Memory not found'));
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

  logger.info({ discordUserId, memoryId }, '[Memory] Memory deleted');
  sendCustomSuccess(res, { success: true }, StatusCodes.OK);
}
