/**
 * Single Memory Operations Handler
 * CRUD operations for individual memories
 */

import type { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, type PrismaClient, MemoryUpdateSchema } from '@tzurot/common-types';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { getParam } from '../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('user-memory-single');

const MEMORY_NOT_FOUND = 'Memory not found';
const MEMORY_ID_REQUIRED = 'Memory ID is required';

/** Include clause for personality in memory queries */
const PERSONALITY_INCLUDE = {
  personality: {
    select: { name: true, displayName: true },
  },
} as const;

interface OwnershipContext {
  prisma: PrismaClient;
  getUserByDiscordId: (id: string, res: Response) => Promise<{ id: string } | null>;
  getDefaultPersonaId: (prisma: PrismaClient, userId: string) => Promise<string | null>;
  discordUserId: string;
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
  const { prisma, getUserByDiscordId, getDefaultPersonaId, discordUserId, memoryId, res } = context;

  const user = await getUserByDiscordId(discordUserId, res);
  if (!user) {
    return null;
  }

  const personaId = await getDefaultPersonaId(prisma, user.id);
  if (personaId === null) {
    sendError(res, ErrorResponses.notFound(MEMORY_NOT_FOUND));
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
    sendError(res, ErrorResponses.notFound(MEMORY_NOT_FOUND));
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
export async function handleGetMemory(
  prisma: PrismaClient,
  getUserByDiscordId: (id: string, res: Response) => Promise<{ id: string } | null>,
  getDefaultPersonaId: (prisma: PrismaClient, userId: string) => Promise<string | null>,
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const discordUserId = req.userId;
  const memoryId = getParam(req.params.id);

  if (memoryId === undefined || memoryId.length === 0) {
    sendError(res, ErrorResponses.validationError(MEMORY_ID_REQUIRED));
    return;
  }

  const user = await getUserByDiscordId(discordUserId, res);
  if (!user) {
    return;
  }

  const personaId = await getDefaultPersonaId(prisma, user.id);
  if (personaId === null) {
    sendError(res, ErrorResponses.notFound(MEMORY_NOT_FOUND));
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
    sendError(res, ErrorResponses.notFound(MEMORY_NOT_FOUND));
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
    getUserByDiscordId,
    getDefaultPersonaId,
    discordUserId,
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
  const memoryId = getParam(req.params.id);

  if (memoryId === undefined || memoryId.length === 0) {
    sendError(res, ErrorResponses.validationError(MEMORY_ID_REQUIRED));
    return;
  }

  const existing = await verifyMemoryOwnership({
    prisma,
    getUserByDiscordId,
    getDefaultPersonaId,
    discordUserId,
    memoryId,
    res,
  });
  if (existing === null) {
    return;
  }

  const memory = await prisma.memory.update({
    where: { id: memoryId },
    data: {
      isLocked: !existing.isLocked,
      updatedAt: new Date(),
    },
    include: PERSONALITY_INCLUDE,
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
  const memoryId = getParam(req.params.id);

  if (memoryId === undefined || memoryId.length === 0) {
    sendError(res, ErrorResponses.validationError(MEMORY_ID_REQUIRED));
    return;
  }

  const existing = await verifyMemoryOwnership({
    prisma,
    getUserByDiscordId,
    getDefaultPersonaId,
    discordUserId,
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

  logger.info({ discordUserId, memoryId }, '[Memory] Memory deleted');
  sendCustomSuccess(res, { success: true }, StatusCodes.OK);
}
