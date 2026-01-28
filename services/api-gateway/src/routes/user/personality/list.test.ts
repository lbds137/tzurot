/**
 * Tests for GET /user/personality (list all personalities)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';
import {
  createMockPrisma,
  createMockReqRes,
  getHandler,
  mockIsBotOwner,
  setupStandardMocks,
} from './test-utils.js';

// Mock dependencies before imports
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  const { mockIsBotOwner: mockFn } = await import('./test-utils.js');

  // Create isBotOwner that uses the mockable function
  const isBotOwner = (...args: unknown[]) => (mockFn as (...args: unknown[]) => boolean)(...args);

  // Redefine computePersonalityPermissions to use the mocked isBotOwner
  const computePersonalityPermissions = (
    ownerId: string,
    requestingUserId: string | null,
    discordUserId: string
  ) => {
    const isCreator = requestingUserId !== null && ownerId === requestingUserId;
    const isAdmin = isBotOwner(discordUserId);
    return {
      canEdit: isCreator || isAdmin,
      canDelete: isCreator || isAdmin,
    };
  };

  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    isBotOwner,
    computePersonalityPermissions,
  };
});

vi.mock('../../../services/AuthMiddleware.js', () => ({
  requireUserAuth: vi.fn(() => vi.fn((_req: unknown, _res: unknown, next: () => void) => next())),
}));

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

import { createPersonalityRoutes } from './index.js';

describe('GET /user/personality (list)', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    setupStandardMocks(mockPrisma);
  });

  it('should return public personalities', async () => {
    const publicPersonality = {
      id: 'personality-1',
      name: 'Public Character',
      displayName: 'Public',
      slug: 'public-character',
      ownerId: 'other-user',
      isPublic: true,
      owner: { discordId: 'other-discord-id' },
    };
    mockPrisma.personality.findMany
      .mockResolvedValueOnce([publicPersonality])
      .mockResolvedValueOnce([]);

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/');
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        personalities: [
          expect.objectContaining({
            id: 'personality-1',
            slug: 'public-character',
            isOwned: false,
            isPublic: true,
            permissions: { canEdit: false, canDelete: false }, // User doesn't own
          }),
        ],
      })
    );
  });

  it('should return owned personalities with isOwned=true', async () => {
    const ownedPersonality = {
      id: 'personality-2',
      name: 'My Character',
      displayName: 'Mine',
      slug: 'my-character',
      ownerId: 'user-uuid-123',
      isPublic: false,
      owner: { discordId: 'discord-123456789' },
    };
    mockPrisma.personality.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([ownedPersonality]);

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/');
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        personalities: [
          expect.objectContaining({
            id: 'personality-2',
            slug: 'my-character',
            isOwned: true,
            isPublic: false,
            permissions: { canEdit: true, canDelete: true }, // User owns
          }),
        ],
      })
    );
  });

  it('should handle user not found', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.personality.findMany.mockResolvedValue([]);

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/');
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        personalities: [],
      })
    );
  });

  describe('admin (bot owner) flow', () => {
    beforeEach(() => {
      // Set up as bot owner
      mockIsBotOwner.mockReturnValue(true);
    });

    it('should return all personalities for bot owner', async () => {
      const allPersonalities = [
        {
          id: 'personality-1',
          name: 'Public Character',
          displayName: 'Public',
          slug: 'public-char',
          ownerId: 'other-user',
          isPublic: true,
          owner: { discordId: '111111111111111111' },
        },
        {
          id: 'personality-2',
          name: 'Private Character',
          displayName: 'Private',
          slug: 'private-char',
          ownerId: 'another-user',
          isPublic: false,
          owner: { discordId: '222222222222222222' },
        },
        {
          id: 'personality-3',
          name: 'Admin Character',
          displayName: 'Admin',
          slug: 'admin-char',
          ownerId: 'user-uuid-123', // Owned by bot owner
          isPublic: false,
          owner: { discordId: 'test-user-id' },
        },
      ];
      mockPrisma.personality.findMany.mockResolvedValueOnce(allPersonalities);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personalities: expect.arrayContaining([
            expect.objectContaining({
              id: 'personality-1',
              slug: 'public-char',
              isOwned: false, // Truthful: not created by bot owner
              isPublic: true,
              permissions: { canEdit: true, canDelete: true }, // But bot owner can edit
            }),
            expect.objectContaining({
              id: 'personality-2',
              slug: 'private-char',
              isOwned: false, // Truthful: not created by bot owner
              isPublic: false,
              permissions: { canEdit: true, canDelete: true }, // But bot owner can edit
            }),
            expect.objectContaining({
              id: 'personality-3',
              slug: 'admin-char',
              isOwned: true, // Truthful: created by bot owner
              isPublic: false,
              permissions: { canEdit: true, canDelete: true },
            }),
          ]),
        })
      );
    });

    it('should include owner Discord ID in admin response', async () => {
      const personalityWithOwner = {
        id: 'personality-with-owner',
        name: 'Owned Character',
        displayName: 'Owned',
        slug: 'owned-char',
        ownerId: 'some-uuid',
        isPublic: false,
        owner: { discordId: '333333333333333333' },
      };
      mockPrisma.personality.findMany.mockResolvedValueOnce([personalityWithOwner]);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personalities: [
            expect.objectContaining({
              ownerDiscordId: '333333333333333333',
            }),
          ],
        })
      );
    });

    it('should return ownerDiscordId for personalities with owner', async () => {
      const personalityWithOwner = {
        id: 'personality-with-owner',
        name: 'Owned Character',
        displayName: 'Owned',
        slug: 'owned-char',
        ownerId: 'owner-user-id',
        isPublic: true,
        owner: { discordId: 'owner-discord-id' },
      };
      mockPrisma.personality.findMany.mockResolvedValueOnce([personalityWithOwner]);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personalities: [
            expect.objectContaining({
              ownerId: 'owner-user-id',
              ownerDiscordId: 'owner-discord-id',
            }),
          ],
        })
      );
    });
  });
});
