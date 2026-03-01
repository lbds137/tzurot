/**
 * Shared test utilities for channel activation route tests
 */

import { vi } from 'vitest';
import {
  createMockIsBotOwner,
  createMockCreatedAt,
  createMockReqRes,
  getHandler,
  type RouteHandler,
} from '../../../test/shared-route-test-utils.js';

// Re-export shared utilities used by test files
export { createMockReqRes, getHandler, createMockCreatedAt, type RouteHandler };

// Mock isBotOwner - must be before vi.mock to be hoisted
export const mockIsBotOwner = createMockIsBotOwner();

// Valid UUIDs for testing
export const MOCK_USER_UUID = '550e8400-e29b-41d4-a716-446655440000';
export const MOCK_PERSONALITY_UUID = '550e8400-e29b-41d4-a716-446655440001';
export const MOCK_ACTIVATION_UUID = '550e8400-e29b-41d4-a716-446655440002';
export const MOCK_DISCORD_USER_ID = '123456789012345678';

// Mock Prisma client with tables needed for channel settings tests + UserService dependencies
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
    findUnique: ReturnType<typeof vi.fn>;
  };
  personalityOwner: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  channelSettings: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
} {
  const mockPrisma = {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({
        id: MOCK_USER_UUID,
        username: 'test-user',
        defaultPersonaId: null,
        isSuperuser: false,
      }),
      create: vi.fn(),
      update: vi.fn(),
    },
    persona: {
      create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
    },
    personality: {
      findUnique: vi.fn(),
    },
    personalityOwner: {
      findUnique: vi.fn(),
    },
    channelSettings: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  // $transaction calls the callback with the same mock prisma as the tx client
  // Also supports UserService transaction pattern
  mockPrisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => {
      // Create a tx-like object with UserService needs
      const mockTx = {
        ...mockPrisma,
        user: {
          ...mockPrisma.user,
          create: vi.fn().mockResolvedValue({ id: MOCK_USER_UUID }),
          update: vi.fn().mockResolvedValue({ id: MOCK_USER_UUID }), // For new user creation
          updateMany: vi.fn().mockResolvedValue({ count: 1 }), // Idempotent backfill
          findUnique: vi.fn().mockResolvedValue({ defaultPersonaId: null }), // For backfill check
        },
        persona: {
          create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
        },
      };
      return callback(mockTx as unknown as typeof mockPrisma);
    }
  );

  return mockPrisma;
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

// Valid guild ID for testing
export const MOCK_GUILD_ID = '987654321098765432';

// Base mock channel settings for tests
export function createMockActivation(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: MOCK_ACTIVATION_UUID,
    channelId: MOCK_DISCORD_USER_ID,
    guildId: MOCK_GUILD_ID,
    createdBy: MOCK_USER_UUID,
    createdAt: createMockCreatedAt(),
    autoRespond: true,
    activatedPersonalityId: MOCK_PERSONALITY_UUID,
    activatedPersonality: {
      slug: 'test-character',
      displayName: 'Test Character',
    },
    ...overrides,
  };
}

// Standard beforeEach setup for tests that need user/personality/settings state
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
  mockPrisma.channelSettings.findFirst.mockResolvedValue(null);
  mockPrisma.channelSettings.findUnique.mockResolvedValue(null);
  mockPrisma.channelSettings.findMany.mockResolvedValue([]);
  mockPrisma.channelSettings.delete.mockResolvedValue({});
}
