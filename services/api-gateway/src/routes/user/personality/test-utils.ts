/**
 * Shared test utilities for personality route tests
 */

import { vi } from 'vitest';
import {
  createMockIsBotOwner,
  createMockCreatedAt,
  createMockUpdatedAt,
  createMockReqRes,
  getHandler,
  createUserServiceTransactionMock,
  type RouteHandler,
} from '../../../test/shared-route-test-utils.js';

// Re-export shared utilities used by test files
export { createMockReqRes, getHandler, type RouteHandler };

// Mock isBotOwner - must be before vi.mock to be hoisted
export const mockIsBotOwner = createMockIsBotOwner();

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
    $transaction: createUserServiceTransactionMock('test-user-uuid', 'test-persona-uuid'),
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
    // eslint-disable-next-line sonarjs/no-duplicate-string -- Test fixture UUID shared across mock factory functions
    ownerId: 'user-uuid-123',
    avatarData: null,
    createdAt: createMockCreatedAt(),
    updatedAt: createMockUpdatedAt(),
    ...overrides,
  };
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
