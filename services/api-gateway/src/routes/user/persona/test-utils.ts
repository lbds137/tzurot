/**
 * Shared test utilities for persona route tests
 */

import { vi } from 'vitest';
import type { Request, Response } from 'express';
import type { Router } from 'express';

// Valid UUIDs for testing (required by route validation)
export const MOCK_USER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
export const MOCK_PERSONA_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
export const MOCK_PERSONA_ID_2 = 'f6a7b8c9-d0e1-2345-f012-456789012345';
export const MOCK_PERSONALITY_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
export const NONEXISTENT_UUID = 'd4e5f6a7-b8c9-0123-def0-234567890123';

export const mockUser = {
  id: MOCK_USER_ID,
  defaultPersonaId: MOCK_PERSONA_ID,
};

// Mock date factories for consistent testing (factory functions avoid mutable module state)
export const createMockCreatedAt = (): Date => new Date('2025-01-01T00:00:00.000Z');
export const createMockUpdatedAt = (): Date => new Date('2025-01-02T00:00:00.000Z');

/** Factory function for creating mock persona (avoids mutable module state) */
export function createMockPersona(
  overrides: Partial<typeof defaultMockPersona> = {}
): typeof defaultMockPersona {
  return {
    ...defaultMockPersona,
    createdAt: createMockCreatedAt(),
    updatedAt: createMockUpdatedAt(),
    ...overrides,
  };
}

const defaultMockPersona = {
  id: MOCK_PERSONA_ID,
  name: 'Test Persona',
  preferredName: 'Tester',
  description: 'A test persona',
  content: 'I am a test persona for unit tests.',
  pronouns: 'they/them',
  shareLtmAcrossPersonalities: false,
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  updatedAt: new Date('2025-01-02T00:00:00.000Z'),
};

/** @deprecated Use createMockPersona() instead - this exports mutable state */
export const mockPersona = defaultMockPersona;

/** Mock Prisma client type for testing - includes UserService dependencies */
export interface MockPrismaClient {
  user: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  persona: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  personality: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  userPersonalityConfig: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
}

/** Create mock Prisma client for testing - includes UserService dependencies */
export function createMockPrisma(): MockPrismaClient {
  return {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({
        id: MOCK_USER_ID,
        username: 'test-user',
        defaultPersonaId: MOCK_PERSONA_ID,
        isSuperuser: false,
      }),
      create: vi.fn(),
      update: vi.fn(),
    },
    persona: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: MOCK_PERSONA_ID }),
      update: vi.fn(),
      delete: vi.fn(),
    },
    personality: {
      findUnique: vi.fn(),
    },
    userPersonalityConfig: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
      const mockTx = {
        user: {
          create: vi.fn().mockResolvedValue({ id: MOCK_USER_ID }),
          update: vi.fn().mockResolvedValue({ id: MOCK_USER_ID }), // For new user creation
          updateMany: vi.fn().mockResolvedValue({ count: 1 }), // Idempotent backfill
          findUnique: vi.fn().mockResolvedValue({ defaultPersonaId: null }), // For backfill check
        },
        persona: {
          create: vi.fn().mockResolvedValue({ id: MOCK_PERSONA_ID }),
        },
      };
      await callback(mockTx);
    }),
  };
}

/** Mock request/response type for testing */
export interface MockReqRes {
  req: Request & { userId: string };
  res: Response;
}

/** Create mock request/response for testing */
export function createMockReqRes(
  body: Record<string, unknown> = {},
  params: Record<string, string> = {}
): MockReqRes {
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

/**
 * Get handler from router by method and path.
 * This is test utility code that accesses Express router internals.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/array-type, @typescript-eslint/no-unsafe-function-type */
export function getHandler(
  router: Router,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string
): Function {
  const layer = (router.stack as any[]).find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method]
  );
  if (layer === undefined || layer === null) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }
  return (layer as { route: { stack: Array<{ handle: Function }> } }).route.stack[
    (layer as { route: { stack: Array<{ handle: Function }> } }).route.stack.length - 1
  ].handle;
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/array-type, @typescript-eslint/no-unsafe-function-type */
