/**
 * Shared test utilities for persona route tests
 */

import { vi } from 'vitest';
import {
  createMockReqRes,
  getHandler,
  createUserServiceTransactionMock,
  type RouteHandler,
} from '../../../test/shared-route-test-utils.js';

// Re-export shared utilities used by test files
export { createMockReqRes, getHandler, type RouteHandler };

// Valid UUIDs for testing (required by route validation)
export const MOCK_USER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
export const MOCK_PERSONA_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
export const MOCK_PERSONA_ID_2 = 'f6a7b8c9-d0e1-4345-a012-456789012345';
export const MOCK_PERSONALITY_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
export const NONEXISTENT_UUID = 'd4e5f6a7-b8c9-4123-9ef0-234567890123';

export const mockUser = {
  id: MOCK_USER_ID,
  defaultPersonaId: MOCK_PERSONA_ID,
};

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
interface MockPrismaClient {
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
    $transaction: createUserServiceTransactionMock(MOCK_USER_ID, MOCK_PERSONA_ID),
  };
}
