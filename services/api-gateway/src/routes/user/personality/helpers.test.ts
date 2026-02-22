/**
 * Tests for personality route helpers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';

// Mock isBotOwner - must be before vi.mock to be hoisted
const mockIsBotOwner = vi.fn().mockReturnValue(false);

// Mock dependencies before imports
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    isBotOwner: (...args: unknown[]) => mockIsBotOwner(...args),
  };
});

import type { Response } from 'express';
import {
  getOrCreateInternalUser,
  canUserEditPersonality,
  canUserViewPersonality,
  resolvePersonalityForEdit,
} from './helpers.js';

describe('personality route helpers', () => {
  // Mock Prisma with methods needed by UserService
  const mockPrisma = {
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
      findUnique: vi.fn(),
    },
    personalityOwner: {
      findUnique: vi.fn(),
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

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBotOwner.mockReturnValue(false);
  });

  describe('getOrCreateInternalUser', () => {
    it('should return existing user when found', async () => {
      // UserService uses findUnique, not findFirst
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'existing-user-id',
        username: 'existing-username',
        defaultPersonaId: null,
        isSuperuser: false,
      });

      const result = await getOrCreateInternalUser(
        mockPrisma as unknown as PrismaClient,
        'discord-123'
      );

      // Returns { id: userId } after UserService lookup
      expect(result).toEqual({ id: 'existing-user-id' });
      expect(mockPrisma.user.findUnique).toHaveBeenCalled();
    });

    it('should create user when not found', async () => {
      // User doesn't exist - UserService will create via $transaction
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await getOrCreateInternalUser(
        mockPrisma as unknown as PrismaClient,
        'discord-456'
      );

      // UserService creates user with deterministic UUID via $transaction
      expect(result).toEqual({ id: expect.any(String) });
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('canUserEditPersonality', () => {
    it('should return true for bot owner', async () => {
      mockIsBotOwner.mockReturnValue(true);

      const result = await canUserEditPersonality(
        mockPrisma as unknown as PrismaClient,
        'user-id',
        'personality-id',
        'bot-owner-discord-id'
      );

      expect(result).toBe(true);
      expect(mockIsBotOwner).toHaveBeenCalledWith('bot-owner-discord-id');
      // Should not query database when bot owner
      expect(mockPrisma.personality.findUnique).not.toHaveBeenCalled();
    });

    it('should return true for direct owner', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        ownerId: 'user-id',
      });

      const result = await canUserEditPersonality(
        mockPrisma as unknown as PrismaClient,
        'user-id',
        'personality-id',
        'regular-discord-id'
      );

      expect(result).toBe(true);
      // Should not query PersonalityOwner when user is direct owner
      expect(mockPrisma.personalityOwner.findUnique).not.toHaveBeenCalled();
    });

    it('should return true for PersonalityOwner entry', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        ownerId: 'other-user-id',
      });
      // User has co-ownership entry
      mockPrisma.personalityOwner.findUnique.mockResolvedValue({
        userId: 'user-id',
        personalityId: 'personality-id',
      });

      const result = await canUserEditPersonality(
        mockPrisma as unknown as PrismaClient,
        'user-id',
        'personality-id',
        'regular-discord-id'
      );

      expect(result).toBe(true);
      expect(mockPrisma.personalityOwner.findUnique).toHaveBeenCalledWith({
        where: {
          personalityId_userId: {
            personalityId: 'personality-id',
            userId: 'user-id',
          },
        },
      });
    });

    it('should return false when personality not found', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const result = await canUserEditPersonality(
        mockPrisma as unknown as PrismaClient,
        'user-id',
        'nonexistent-personality',
        'regular-discord-id'
      );

      expect(result).toBe(false);
    });

    it('should return false when user has no ownership', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        ownerId: 'other-user-id',
      });
      mockPrisma.personalityOwner.findUnique.mockResolvedValue(null);

      const result = await canUserEditPersonality(
        mockPrisma as unknown as PrismaClient,
        'user-id',
        'personality-id',
        'regular-discord-id'
      );

      expect(result).toBe(false);
    });

    it('should work without discordUserId parameter', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        ownerId: 'user-id',
      });

      const result = await canUserEditPersonality(
        mockPrisma as unknown as PrismaClient,
        'user-id',
        'personality-id'
        // No discordUserId
      );

      expect(result).toBe(true);
      expect(mockIsBotOwner).not.toHaveBeenCalled();
    });

    it('should check ownership via PersonalityOwner table when not direct owner', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        ownerId: 'other-user-id',
      });
      mockPrisma.personalityOwner.findUnique.mockResolvedValue(null);

      await canUserEditPersonality(
        mockPrisma as unknown as PrismaClient,
        'user-id',
        'personality-id'
      );

      // Verify personality lookup
      expect(mockPrisma.personality.findUnique).toHaveBeenCalledWith({
        where: { id: 'personality-id' },
        select: { ownerId: true },
      });

      // Verify PersonalityOwner lookup
      expect(mockPrisma.personalityOwner.findUnique).toHaveBeenCalledWith({
        where: {
          personalityId_userId: {
            personalityId: 'personality-id',
            userId: 'user-id',
          },
        },
      });
    });
  });

  describe('canUserViewPersonality', () => {
    it('should return true for bot owner', async () => {
      mockIsBotOwner.mockReturnValue(true);

      const result = await canUserViewPersonality({
        prisma: mockPrisma as unknown as PrismaClient,
        userId: 'user-id',
        personalityId: 'personality-id',
        isPublic: false, // not public
        ownerId: 'other-owner-id',
        discordUserId: 'bot-owner-discord-id',
      });

      expect(result).toBe(true);
      expect(mockIsBotOwner).toHaveBeenCalledWith('bot-owner-discord-id');
    });

    it('should return true for public personality', async () => {
      const result = await canUserViewPersonality({
        prisma: mockPrisma as unknown as PrismaClient,
        userId: 'user-id',
        personalityId: 'personality-id',
        isPublic: true, // public
        ownerId: 'other-owner-id',
        discordUserId: 'regular-discord-id',
      });

      expect(result).toBe(true);
      // Should not query database for public personalities
      expect(mockPrisma.personalityOwner.findUnique).not.toHaveBeenCalled();
    });

    it('should return true for direct owner', async () => {
      const result = await canUserViewPersonality({
        prisma: mockPrisma as unknown as PrismaClient,
        userId: 'user-id',
        personalityId: 'personality-id',
        isPublic: false,
        ownerId: 'user-id', // user is owner
        discordUserId: 'regular-discord-id',
      });

      expect(result).toBe(true);
    });

    it('should return true for PersonalityOwner entry', async () => {
      mockPrisma.personalityOwner.findUnique.mockResolvedValue({
        userId: 'user-id',
        personalityId: 'personality-id',
      });

      const result = await canUserViewPersonality({
        prisma: mockPrisma as unknown as PrismaClient,
        userId: 'user-id',
        personalityId: 'personality-id',
        isPublic: false,
        ownerId: 'other-owner-id',
        discordUserId: 'regular-discord-id',
      });

      expect(result).toBe(true);
      expect(mockPrisma.personalityOwner.findUnique).toHaveBeenCalledWith({
        where: {
          personalityId_userId: {
            personalityId: 'personality-id',
            userId: 'user-id',
          },
        },
      });
    });

    it('should return false when userId is null', async () => {
      const result = await canUserViewPersonality({
        prisma: mockPrisma as unknown as PrismaClient,
        userId: null, // null user
        personalityId: 'personality-id',
        isPublic: false,
        ownerId: 'other-owner-id',
        discordUserId: 'regular-discord-id',
      });

      expect(result).toBe(false);
    });

    it('should return false when user has no access', async () => {
      mockPrisma.personalityOwner.findUnique.mockResolvedValue(null);

      const result = await canUserViewPersonality({
        prisma: mockPrisma as unknown as PrismaClient,
        userId: 'user-id',
        personalityId: 'personality-id',
        isPublic: false,
        ownerId: 'other-owner-id',
        discordUserId: 'regular-discord-id',
      });

      expect(result).toBe(false);
    });
  });

  describe('resolvePersonalityForEdit', () => {
    function createMockRes() {
      return {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as Response;
    }

    it('should return 403 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      const res = createMockRes();

      const result = await resolvePersonalityForEdit(
        mockPrisma as unknown as PrismaClient,
        'test-slug',
        'discord-unknown',
        res,
        { id: true, ownerId: true }
      );

      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 404 when personality not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-id' });
      mockPrisma.personality.findUnique.mockResolvedValue(null);
      const res = createMockRes();

      const result = await resolvePersonalityForEdit(
        mockPrisma as unknown as PrismaClient,
        'nonexistent-slug',
        'discord-123',
        res,
        { id: true, ownerId: true }
      );

      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Personality not found' })
      );
    });

    it('should return 403 when user lacks edit permission', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-id' });
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'pers-id',
        ownerId: 'other-user-id',
      });
      mockPrisma.personalityOwner.findUnique.mockResolvedValue(null);
      const res = createMockRes();

      const result = await resolvePersonalityForEdit(
        mockPrisma as unknown as PrismaClient,
        'test-slug',
        'discord-123',
        res,
        { id: true, ownerId: true }
      );

      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('permission') })
      );
    });

    it('should return user and personality on success', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-id' });
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'pers-id',
        ownerId: 'user-id',
        name: 'Test',
      });
      const res = createMockRes();

      const result = await resolvePersonalityForEdit(
        mockPrisma as unknown as PrismaClient,
        'test-slug',
        'discord-123',
        res,
        { id: true, ownerId: true, name: true }
      );

      expect(result).not.toBeNull();
      expect(result!.user).toEqual({ id: 'user-id' });
      expect(result!.personality).toEqual({ id: 'pers-id', ownerId: 'user-id', name: 'Test' });
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
