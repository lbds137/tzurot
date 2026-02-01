/**
 * Unit Tests for Entity Permissions Utilities
 *
 * Tests the centralized permission computation functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computePersonalityPermissions,
  computeLlmConfigPermissions,
  computePersonaPermissions,
} from './permissions.js';

// Mock isBotOwner
const mockIsBotOwner = vi.fn();
vi.mock('./ownerMiddleware.js', () => ({
  isBotOwner: (userId: string) => mockIsBotOwner(userId),
}));

describe('permissions utilities', () => {
  const OWNER_ID = 'owner-uuid-123';
  const OTHER_USER_ID = 'other-uuid-456';
  const ADMIN_DISCORD_ID = 'admin-discord-789';
  const USER_DISCORD_ID = 'user-discord-012';

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: not an admin
    mockIsBotOwner.mockReturnValue(false);
  });

  describe('computePersonalityPermissions', () => {
    it('should grant full permissions to creator', () => {
      const result = computePersonalityPermissions(OWNER_ID, OWNER_ID, USER_DISCORD_ID);

      expect(result).toEqual({ canEdit: true, canDelete: true });
    });

    it('should grant full permissions to admin (non-creator)', () => {
      mockIsBotOwner.mockReturnValue(true);

      const result = computePersonalityPermissions(OWNER_ID, OTHER_USER_ID, ADMIN_DISCORD_ID);

      expect(mockIsBotOwner).toHaveBeenCalledWith(ADMIN_DISCORD_ID);
      expect(result).toEqual({ canEdit: true, canDelete: true });
    });

    it('should deny permissions to non-creator non-admin', () => {
      const result = computePersonalityPermissions(OWNER_ID, OTHER_USER_ID, USER_DISCORD_ID);

      expect(result).toEqual({ canEdit: false, canDelete: false });
    });

    it('should deny permissions when requestingUserId is null', () => {
      const result = computePersonalityPermissions(OWNER_ID, null, USER_DISCORD_ID);

      expect(result).toEqual({ canEdit: false, canDelete: false });
    });

    // Note: Personality.ownerId is NOT nullable in the schema (String, not String?)
    // so we don't need to test null ownerId scenarios - they can't exist in the DB
  });

  describe('computeLlmConfigPermissions', () => {
    // Note: LlmConfig.ownerId is NOT nullable in the schema (String, not String?)
    // All configs have an owner - "global" just means visible to all users

    describe('global configs', () => {
      it('should grant permissions to creator of global config (user shared their preset)', () => {
        // Users can share their presets by making them global while retaining control
        const globalConfig = { ownerId: OWNER_ID, isGlobal: true };

        const result = computeLlmConfigPermissions(globalConfig, OWNER_ID, USER_DISCORD_ID);

        // Creator retains permissions even when config is global
        expect(result).toEqual({ canEdit: true, canDelete: true });
      });

      it('should grant full permissions to admin for global config', () => {
        mockIsBotOwner.mockReturnValue(true);
        const globalConfig = { ownerId: OWNER_ID, isGlobal: true };

        const result = computeLlmConfigPermissions(globalConfig, OTHER_USER_ID, ADMIN_DISCORD_ID);

        expect(result).toEqual({ canEdit: true, canDelete: true });
      });

      it('should deny permissions to non-creator non-admin for global config', () => {
        const globalConfig = { ownerId: OWNER_ID, isGlobal: true };

        const result = computeLlmConfigPermissions(globalConfig, OTHER_USER_ID, USER_DISCORD_ID);

        expect(result).toEqual({ canEdit: false, canDelete: false });
      });
    });

    describe('user configs', () => {
      const userConfig = { ownerId: OWNER_ID, isGlobal: false };

      it('should grant full permissions to creator of user config', () => {
        const result = computeLlmConfigPermissions(userConfig, OWNER_ID, USER_DISCORD_ID);

        expect(result).toEqual({ canEdit: true, canDelete: true });
      });

      it('should grant full permissions to admin for user config', () => {
        mockIsBotOwner.mockReturnValue(true);

        const result = computeLlmConfigPermissions(userConfig, OTHER_USER_ID, ADMIN_DISCORD_ID);

        expect(result).toEqual({ canEdit: true, canDelete: true });
      });

      it('should deny permissions to non-creator non-admin for user config', () => {
        const result = computeLlmConfigPermissions(userConfig, OTHER_USER_ID, USER_DISCORD_ID);

        expect(result).toEqual({ canEdit: false, canDelete: false });
      });

      it('should deny permissions when requestingUserId is null', () => {
        const result = computeLlmConfigPermissions(userConfig, null, USER_DISCORD_ID);

        expect(result).toEqual({ canEdit: false, canDelete: false });
      });

      // Note: LlmConfig.ownerId is NOT nullable in schema - no orphaned configs can exist
    });
  });

  describe('computePersonaPermissions', () => {
    it('should grant full permissions to creator', () => {
      const result = computePersonaPermissions(OWNER_ID, OWNER_ID);

      expect(result).toEqual({ canEdit: true, canDelete: true });
    });

    it('should deny permissions to non-creator', () => {
      const result = computePersonaPermissions(OWNER_ID, OTHER_USER_ID);

      expect(result).toEqual({ canEdit: false, canDelete: false });
    });

    it('should deny permissions when requestingUserId is null', () => {
      const result = computePersonaPermissions(OWNER_ID, null);

      expect(result).toEqual({ canEdit: false, canDelete: false });
    });

    it('should not grant admin override for personas (intentional design)', () => {
      // Note: computePersonaPermissions intentionally does NOT check isBotOwner
      // This is documented in the function - personas are user-specific
      // and don't need admin override currently

      // Even if the user is an admin, they can't edit others' personas
      // (We don't even call isBotOwner in this function)
      const result = computePersonaPermissions(OWNER_ID, OTHER_USER_ID);

      expect(result).toEqual({ canEdit: false, canDelete: false });
      // Verify isBotOwner was NOT called
      expect(mockIsBotOwner).not.toHaveBeenCalled();
    });
  });
});
