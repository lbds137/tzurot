/**
 * Tests for Memory List Handler
 *
 * Tests pagination, sorting, filtering, and edge cases
 * for the GET /user/memory/list endpoint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { PrismaClient } from '@tzurot/common-types';
import type { AuthenticatedRequest } from '../../types.js';

// Mock common-types
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock memory helpers
vi.mock('./memoryHelpers.js', () => ({
  getUserByDiscordId: vi.fn(),
  getDefaultPersonaId: vi.fn(),
}));

import { handleList } from './memoryList.js';
import { getUserByDiscordId, getDefaultPersonaId } from './memoryHelpers.js';

const mockGetUserByDiscordId = vi.mocked(getUserByDiscordId);
const mockGetDefaultPersonaId = vi.mocked(getDefaultPersonaId);

// Mock Prisma
const mockPrisma = {
  memory: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
} as unknown as PrismaClient;

function createMockReqRes(query: Record<string, string> = {}) {
  const req = {
    query,
    userId: 'discord-user-123',
  } as unknown as AuthenticatedRequest;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

const now = new Date('2025-01-15T10:00:00Z');

function createMockMemory(
  overrides: Partial<{
    id: string;
    content: string;
    isLocked: boolean;
    personalityId: string;
    personalityName: string;
  }> = {}
) {
  return {
    id: overrides.id ?? 'mem-1',
    content: overrides.content ?? 'Test memory content',
    createdAt: now,
    updatedAt: now,
    personalityId: overrides.personalityId ?? 'personality-1',
    isLocked: overrides.isLocked ?? false,
    personality: {
      name: 'test-personality',
      displayName: overrides.personalityName ?? 'Test Personality',
    },
  };
}

describe('handleList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserByDiscordId.mockResolvedValue({ id: 'user-uuid-123' });
    mockGetDefaultPersonaId.mockResolvedValue('persona-uuid-456');
    (mockPrisma.memory.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    (mockPrisma.memory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('should return empty list when no memories exist', async () => {
    const { req, res } = createMockReqRes();

    await handleList(mockPrisma, req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      memories: [],
      total: 0,
      limit: 15,
      offset: 0,
      hasMore: false,
    });
  });

  it('should return memories with correct formatting', async () => {
    const memory = createMockMemory({ id: 'mem-abc', content: 'Important fact' });
    (mockPrisma.memory.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (mockPrisma.memory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([memory]);

    const { req, res } = createMockReqRes();

    await handleList(mockPrisma, req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      memories: [
        {
          id: 'mem-abc',
          content: 'Important fact',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          personalityId: 'personality-1',
          personalityName: 'Test Personality',
          isLocked: false,
        },
      ],
      total: 1,
      limit: 15,
      offset: 0,
      hasMore: false,
    });
  });

  it('should respect custom limit and offset', async () => {
    (mockPrisma.memory.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    const { req, res } = createMockReqRes({ limit: '5', offset: '10' });

    await handleList(mockPrisma, req, res);

    expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 5,
      })
    );
  });

  it('should clamp limit to max 50', async () => {
    const { req, res } = createMockReqRes({ limit: '100' });

    await handleList(mockPrisma, req, res);

    expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it('should clamp limit to min 1', async () => {
    const { req, res } = createMockReqRes({ limit: '-5' });

    await handleList(mockPrisma, req, res);

    expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
  });

  it('should filter by personalityId when provided', async () => {
    const { req, res } = createMockReqRes({ personalityId: 'pers-xyz' });

    await handleList(mockPrisma, req, res);

    expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ personalityId: 'pers-xyz' }),
      })
    );
  });

  it('should sort by updatedAt ascending when specified', async () => {
    const { req, res } = createMockReqRes({ sort: 'updatedAt', order: 'asc' });

    await handleList(mockPrisma, req, res);

    expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { updatedAt: 'asc' },
      })
    );
  });

  it('should default to createdAt desc sort', async () => {
    const { req, res } = createMockReqRes();

    await handleList(mockPrisma, req, res);

    expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      })
    );
  });

  it('should ignore invalid sort field', async () => {
    const { req, res } = createMockReqRes({ sort: 'invalid' });

    await handleList(mockPrisma, req, res);

    expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      })
    );
  });

  it('should set hasMore when there are more results', async () => {
    (mockPrisma.memory.count as ReturnType<typeof vi.fn>).mockResolvedValue(20);
    (mockPrisma.memory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => createMockMemory({ id: `mem-${i}` }))
    );

    const { req, res } = createMockReqRes({ limit: '5' });

    await handleList(mockPrisma, req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hasMore: true, total: 20 }));
  });

  it('should return early with empty list when user has no persona', async () => {
    mockGetDefaultPersonaId.mockResolvedValue(null);
    const { req, res } = createMockReqRes();

    await handleList(mockPrisma, req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ memories: [], total: 0 }));
    expect(mockPrisma.memory.findMany).not.toHaveBeenCalled();
  });

  it('should return early when user not found', async () => {
    mockGetUserByDiscordId.mockResolvedValue(null);
    const { req, res } = createMockReqRes();

    await handleList(mockPrisma, req, res);

    // getUserByDiscordId handles the error response
    expect(mockPrisma.memory.findMany).not.toHaveBeenCalled();
  });

  it('should fall back to personality name when displayName is null', async () => {
    const memory = {
      ...createMockMemory(),
      personality: { name: 'fallback-name', displayName: null },
    };
    (mockPrisma.memory.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (mockPrisma.memory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([memory]);

    const { req, res } = createMockReqRes();

    await handleList(mockPrisma, req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        memories: [expect.objectContaining({ personalityName: 'fallback-name' })],
      })
    );
  });
});
