/**
 * Shared test utilities for personality route tests
 */

import { vi } from 'vitest';
import {
  createMockIsBotOwner,
  createMockCreatedAt,
  createMockUpdatedAt,
  createProvisionedMockReqRes,
  getHandler,
  type RouteHandler,
} from '../../../test/shared-route-test-utils.js';

/**
 * Internal user UUID used by every personality-route test mock. RFC-4122
 * format matches the convention in `persona/test-utils.ts` and
 * `channel/test-utils.ts` — protects against future middleware-side UUID
 * validation that would reject the legacy `'user-uuid-123'` placeholder.
 */
export const MOCK_USER_ID = 'b9c8d7e6-f5a4-4321-b8c7-d6e5f4a3b2c1';

/**
 * Personality-domain wrapper around the shared mock helper. Sets
 * `provisionedUserId` to MOCK_USER_ID so route handlers see the same id
 * as `setupStandardMocks` returns from `mockPrisma.user.findUnique`.
 */
export function createMockReqRes(
  body: Record<string, unknown> = {},
  params: Record<string, string> = {},
  query: Record<string, string> = {}
): ReturnType<typeof createProvisionedMockReqRes> {
  return createProvisionedMockReqRes(body, params, query, {
    provisionedUserId: MOCK_USER_ID,
    // provisionedDefaultPersonaId intentionally omitted — personality routes
    // don't read user.defaultPersonaId, so the sentinel default from the shared
    // helper is fine. Contrast with persona/test-utils, which does set it.
  });
}

// Re-export shared utilities used by test files
export { getHandler, type RouteHandler };

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
  personalityAlias: { findMany: ReturnType<typeof vi.fn> };
  pendingMemory: { count: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  systemPrompt: { findFirst: ReturnType<typeof vi.fn> };
  llmConfig: { findFirst: ReturnType<typeof vi.fn> };
  personalityDefaultConfig: { create: ReturnType<typeof vi.fn> };
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
    personalityAlias: {
      findMany: vi.fn(),
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
    definitionPublic: false,
    voiceEnabled: false,
    imageEnabled: false,
    ownerId: MOCK_USER_ID,
    avatarData: null,
    voiceReferenceType: null,
    customFields: null,
    systemPromptId: null,
    voiceSettings: null,
    imageSettings: null,
    createdAt: createMockCreatedAt(),
    updatedAt: createMockUpdatedAt(),
    ...overrides,
  };
}

// Standard beforeEach setup for tests that need user/personality state
export function setupStandardMocks(mockPrisma: ReturnType<typeof createMockPrisma>): void {
  mockIsBotOwner.mockReturnValue(false);
  // Old findFirst for legacy code paths
  mockPrisma.user.findFirst.mockResolvedValue({ id: MOCK_USER_ID });
  // UserService uses findUnique to look up users
  mockPrisma.user.findUnique.mockResolvedValue({
    id: MOCK_USER_ID,
    username: 'test-user',
    defaultPersonaId: null,
    isSuperuser: false,
  });
  mockPrisma.personality.findMany.mockResolvedValue([]);
  mockPrisma.personality.findUnique.mockResolvedValue(null);
  mockPrisma.personalityOwner.findMany.mockResolvedValue([]);
  mockPrisma.personalityOwner.findUnique.mockResolvedValue(null);
  // Reverse-shadow probe on create/rename: no global aliases shadowed.
  mockPrisma.personalityAlias.findMany.mockResolvedValue([]);
  mockPrisma.llmConfig.findFirst.mockResolvedValue(null);
  mockPrisma.pendingMemory.count.mockResolvedValue(0);
  mockPrisma.pendingMemory.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.personality.delete.mockResolvedValue({});
}
