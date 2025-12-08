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

import {
  getOrCreateInternalUser,
  canUserEditPersonality,
  canUserViewPersonality,
} from './helpers.js';

describe('personality route helpers', () => {
  const mockPrisma = {
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
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBotOwner.mockReturnValue(false);
  });

  describe('getOrCreateInternalUser', () => {
    it('should return existing user when found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'existing-user-id' });

      const result = await getOrCreateInternalUser(
        mockPrisma as unknown as PrismaClient,
        'discord-123'
      );

      expect(result).toEqual({ id: 'existing-user-id' });
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { discordId: 'discord-123' },
        select: { id: true },
      });
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('should create user when not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'new-user-id' });

      const result = await getOrCreateInternalUser(
        mockPrisma as unknown as PrismaClient,
        'discord-456'
      );

      expect(result).toEqual({ id: 'new-user-id' });
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          discordId: 'discord-456',
          username: 'discord-456',
        },
        select: { id: true },
      });
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

      const result = await canUserViewPersonality(
        mockPrisma as unknown as PrismaClient,
        'user-id',
        'personality-id',
        false, // not public
        'other-owner-id',
        'bot-owner-discord-id'
      );

      expect(result).toBe(true);
      expect(mockIsBotOwner).toHaveBeenCalledWith('bot-owner-discord-id');
    });

    it('should return true for public personality', async () => {
      const result = await canUserViewPersonality(
        mockPrisma as unknown as PrismaClient,
        'user-id',
        'personality-id',
        true, // public
        'other-owner-id',
        'regular-discord-id'
      );

      expect(result).toBe(true);
      // Should not query database for public personalities
      expect(mockPrisma.personalityOwner.findUnique).not.toHaveBeenCalled();
    });

    it('should return true for direct owner', async () => {
      const result = await canUserViewPersonality(
        mockPrisma as unknown as PrismaClient,
        'user-id',
        'personality-id',
        false,
        'user-id', // user is owner
        'regular-discord-id'
      );

      expect(result).toBe(true);
    });

    it('should return true for PersonalityOwner entry', async () => {
      mockPrisma.personalityOwner.findUnique.mockResolvedValue({
        userId: 'user-id',
        personalityId: 'personality-id',
      });

      const result = await canUserViewPersonality(
        mockPrisma as unknown as PrismaClient,
        'user-id',
        'personality-id',
        false,
        'other-owner-id',
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

    it('should return false when userId is null', async () => {
      const result = await canUserViewPersonality(
        mockPrisma as unknown as PrismaClient,
        null, // null user
        'personality-id',
        false,
        'other-owner-id',
        'regular-discord-id'
      );

      expect(result).toBe(false);
    });

    it('should return false when user has no access', async () => {
      mockPrisma.personalityOwner.findUnique.mockResolvedValue(null);

      const result = await canUserViewPersonality(
        mockPrisma as unknown as PrismaClient,
        'user-id',
        'personality-id',
        false,
        'other-owner-id',
        'regular-discord-id'
      );

      expect(result).toBe(false);
    });
  });
});
