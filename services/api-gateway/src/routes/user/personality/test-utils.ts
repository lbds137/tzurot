/**
 * Shared test utilities for personality route tests
 */

import { vi } from 'vitest';
import type { Request, Response } from 'express';
import type { Router } from 'express';

// Mock isBotOwner - must be before vi.mock to be hoisted
// Using explicit callable type to avoid TS2742 (inferred type) and TS2348 (not callable) errors
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

// Type for mock Prisma client
export type MockPrisma = ReturnType<typeof createMockPrisma>;

// Mock Prisma client with UserService dependencies
export function createMockPrisma(): {
  user: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  persona: {
    create: ReturnType<typeof vi.fn>;
  };
  personality: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  personalityOwner: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  pendingMemory: { count: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  systemPrompt: { findFirst: ReturnType<typeof vi.fn> };
  llmConfig: { findFirst: ReturnType<typeof vi.fn> };
  personalityDefaultConfig: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
} {
  return {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    persona: {
      create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
    },
    personality: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    personalityOwner: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    pendingMemory: {
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    systemPrompt: {
      findFirst: vi.fn(),
    },
    llmConfig: {
      findFirst: vi.fn(),
    },
    personalityDefaultConfig: {
      create: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
      const mockTx = {
        user: {
          create: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
          update: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }), // For new user creation
          updateMany: vi.fn().mockResolvedValue({ count: 1 }), // Idempotent backfill
          findUnique: vi.fn().mockResolvedValue({ defaultPersonaId: null }), // For backfill check
        },
        persona: {
          create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
        },
      };
      await callback(mockTx);
    }),
  };
}

// Base mock personality with all fields needed for POST/PUT responses
export function createMockPersonality(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'new-personality',
    name: 'New Character',
    slug: 'new-char',
    displayName: null,
    characterInfo: 'Default character info',
    personalityTraits: 'Default traits',
    personalityTone: null,
    personalityAge: null,
    personalityAppearance: null,
    personalityLikes: null,
    personalityDislikes: null,
    conversationalGoals: null,
    conversationalExamples: null,
    errorMessage: null,
    birthMonth: null,
    birthDay: null,
    birthYear: null,
    isPublic: false,
    voiceEnabled: false,
    imageEnabled: false,
    ownerId: 'user-uuid-123',
    avatarData: null,
    createdAt: MOCK_CREATED_AT,
    updatedAt: MOCK_UPDATED_AT,
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

// Standard beforeEach setup for tests that need user/personality state
export function setupStandardMocks(mockPrisma: ReturnType<typeof createMockPrisma>): void {
  mockIsBotOwner.mockReturnValue(false);
  // Old findFirst for legacy code paths
  mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
  // UserService uses findUnique to look up users
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'user-uuid-123',
    username: 'test-user',
    defaultPersonaId: null,
    isSuperuser: false,
  });
  mockPrisma.personality.findMany.mockResolvedValue([]);
  mockPrisma.personality.findUnique.mockResolvedValue(null);
  mockPrisma.personalityOwner.findMany.mockResolvedValue([]);
  mockPrisma.personalityOwner.findUnique.mockResolvedValue(null);
  mockPrisma.llmConfig.findFirst.mockResolvedValue(null);
  mockPrisma.pendingMemory.count.mockResolvedValue(0);
  mockPrisma.pendingMemory.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.personality.delete.mockResolvedValue({});
}
