/**
 * Tests for Dashboard Permission Checks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { checkEditPermission, checkOwnership, isOwner } from './permissionChecks.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';

describe('permissionChecks', () => {
  function createMockInteraction(userId = 'user-123') {
    return {
      user: { id: userId },
      reply: vi.fn(),
    } as unknown as ButtonInteraction | StringSelectMenuInteraction;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkEditPermission', () => {
    it('should return true when canEdit is true', async () => {
      const interaction = createMockInteraction();
      const entity = { canEdit: true };

      const result = await checkEditPermission(interaction, entity);

      expect(result).toBe(true);
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should return false and reply when canEdit is false', async () => {
      const interaction = createMockInteraction();
      const entity = { canEdit: false };

      const result = await checkEditPermission(interaction, entity);

      expect(result).toBe(false);
      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ You do not have permission to edit this.',
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should return false when canEdit is undefined', async () => {
      const interaction = createMockInteraction();
      const entity = {};

      const result = await checkEditPermission(interaction, entity);

      expect(result).toBe(false);
    });

    it('should use custom action in error message', async () => {
      const interaction = createMockInteraction();
      const entity = { canEdit: false };

      await checkEditPermission(interaction, entity, 'modify this preset');

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ You do not have permission to modify this preset.',
        flags: MessageFlags.Ephemeral,
      });
    });
  });

  describe('isOwner', () => {
    it('should return true when userId matches ownerId', () => {
      const entity = { ownerId: 'user-123' };

      expect(isOwner('user-123', entity)).toBe(true);
    });

    it('should return false when userId does not match ownerId', () => {
      const entity = { ownerId: 'user-456' };

      expect(isOwner('user-123', entity)).toBe(false);
    });

    it('should return false when ownerId is undefined', () => {
      const entity = {};

      expect(isOwner('user-123', entity)).toBe(false);
    });
  });

  describe('checkOwnership', () => {
    it('should return true when user is owner', async () => {
      const interaction = createMockInteraction('user-123');
      const entity = { ownerId: 'user-123' };

      const result = await checkOwnership(interaction, entity);

      expect(result).toBe(true);
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should return false and reply when user is not owner', async () => {
      const interaction = createMockInteraction('user-123');
      const entity = { ownerId: 'user-456' };

      const result = await checkOwnership(interaction, entity);

      expect(result).toBe(false);
      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ You do not have permission to modify this.',
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should use custom action in error message', async () => {
      const interaction = createMockInteraction('user-123');
      const entity = { ownerId: 'user-456' };

      await checkOwnership(interaction, entity, 'delete this character');

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ You do not have permission to delete this character.',
        flags: MessageFlags.Ephemeral,
      });
    });
  });
});
