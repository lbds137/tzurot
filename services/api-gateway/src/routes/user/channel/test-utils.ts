/**
 * Shared test utilities for channel activation route tests
 */

import { vi } from 'vitest';
import type { Request, Response } from 'express';
import type { Router } from 'express';

// Mock isBotOwner - must be before vi.mock to be hoisted
export const mockIsBotOwner: ((...args: unknown[]) => boolean) & {
  mockReturnValue: (val: boolean) => void;
  mockReset: () => void;
} = vi.fn().mockReturnValue(false) as ((...args: unknown[]) => boolean) & {
  mockReturnValue: (val: boolean) => void;
  mockReset: () => void;
};

// Mock dates for consistent testing
export const MOCK_CREATED_AT = new Date('2024-01-01T00:00:00.000Z');
export const MOCK_UPDATED_AT = new Date('2024-01-02T00:00:00.000Z');

// Valid UUIDs for testing
export const MOCK_USER_UUID = '550e8400-e29b-41d4-a716-446655440000';
export const MOCK_PERSONALITY_UUID = '550e8400-e29b-41d4-a716-446655440001';
export const MOCK_ACTIVATION_UUID = '550e8400-e29b-41d4-a716-446655440002';
export const MOCK_DISCORD_USER_ID = '123456789012345678';

// Type for mock Prisma client
export type MockPrisma = ReturnType<typeof createMockPrisma>;

// Mock Prisma client with tables needed for channel activation tests
export function createMockPrisma(): {
  user: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  personality: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  personalityOwner: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  activatedChannel: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
} {
  return {
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    personality: {
      findUnique: vi.fn(),
    },
    personalityOwner: {
      findUnique: vi.fn(),
    },
    activatedChannel: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  };
}

// Base mock personality for tests
export function createMockPersonality(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: MOCK_PERSONALITY_UUID,
    name: 'Test Personality',
    displayName: 'Test Character',
    slug: 'test-character',
    isPublic: true,
    ownerId: MOCK_USER_UUID,
    ...overrides,
  };
}

// Base mock activation for tests
export function createMockActivation(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: MOCK_ACTIVATION_UUID,
    channelId: MOCK_DISCORD_USER_ID,
    createdBy: MOCK_USER_UUID,
    createdAt: MOCK_CREATED_AT,
    personality: {
      slug: 'test-character',
      displayName: 'Test Character',
    },
    ...overrides,
  };
}

// Helper to create mock request/response
export function createMockReqRes(
  body: Record<string, unknown> = {},
  params: Record<string, string> = {}
): { req: Request & { userId: string }; res: Response } {
  const req = {
    body,
    params,
    userId: 'discord-user-123',
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

// Helper to get handler from router
type RouteHandler = (req: Request & { userId: string }, res: Response) => Promise<void>;

export function getHandler(
  router: Router,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string
): RouteHandler {
  // Express router internals require unsafe access
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/strict-boolean-expressions */
  const layer = (router.stack as any[]).find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method]
  );
  return layer.route.stack[layer.route.stack.length - 1].handle as RouteHandler;
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/strict-boolean-expressions */
}

// Standard beforeEach setup for tests that need user/personality/activation state
export function setupStandardMocks(mockPrisma: ReturnType<typeof createMockPrisma>): void {
  mockIsBotOwner.mockReturnValue(false);
  mockPrisma.user.findFirst.mockResolvedValue({ id: MOCK_USER_UUID });
  mockPrisma.user.create.mockResolvedValue({
    id: MOCK_USER_UUID,
    discordId: MOCK_DISCORD_USER_ID,
    username: MOCK_DISCORD_USER_ID,
  });
  mockPrisma.personality.findUnique.mockResolvedValue(null);
  mockPrisma.personalityOwner.findUnique.mockResolvedValue(null);
  mockPrisma.activatedChannel.findFirst.mockResolvedValue(null);
  mockPrisma.activatedChannel.findMany.mockResolvedValue([]);
  mockPrisma.activatedChannel.delete.mockResolvedValue({});
}
