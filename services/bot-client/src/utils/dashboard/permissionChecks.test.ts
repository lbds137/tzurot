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

    it('should use followUp when deferred option is true', async () => {
      const interaction = createMockInteraction();
      const interactionWithFollowUp = interaction as unknown as {
        followUp: ReturnType<typeof vi.fn>;
      };
      interactionWithFollowUp.followUp = vi.fn();
      const entity = { canEdit: false };

      const result = await checkEditPermission(interaction, entity, 'edit this', {
        deferred: true,
      });

      expect(result).toBe(false);
      expect(interaction.reply).not.toHaveBeenCalled();
      expect(interactionWithFollowUp.followUp).toHaveBeenCalledWith({
        content: '❌ You do not have permission to edit this.',
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

    it('should return true when isOwned is true', () => {
      const entity = { isOwned: true };

      expect(isOwner('user-123', entity)).toBe(true);
    });

    it('should return false when isOwned is false', () => {
      const entity = { isOwned: false };

      expect(isOwner('user-123', entity)).toBe(false);
    });

    it('should return true when isOwned is true even if ownerId does not match', () => {
      // isOwned takes precedence - if pre-computed as true, trust it
      const entity = { isOwned: true, ownerId: 'user-456' };

      expect(isOwner('user-123', entity)).toBe(true);
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

    it('should return true when isOwned is true', async () => {
      const interaction = createMockInteraction('user-123');
      const entity = { isOwned: true };

      const result = await checkOwnership(interaction, entity);

      expect(result).toBe(true);
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should return true when isOwned is true even if ownerId does not match', async () => {
      const interaction = createMockInteraction('user-123');
      const entity = { isOwned: true, ownerId: 'user-456' };

      const result = await checkOwnership(interaction, entity);

      expect(result).toBe(true);
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should use followUp when deferred option is true', async () => {
      const interaction = createMockInteraction('user-123');
      const interactionWithFollowUp = interaction as unknown as {
        followUp: ReturnType<typeof vi.fn>;
      };
      interactionWithFollowUp.followUp = vi.fn();
      const entity = { ownerId: 'user-456' };

      const result = await checkOwnership(interaction, entity, 'modify this', { deferred: true });

      expect(result).toBe(false);
      expect(interaction.reply).not.toHaveBeenCalled();
      expect(interactionWithFollowUp.followUp).toHaveBeenCalledWith({
        content: '❌ You do not have permission to modify this.',
        flags: MessageFlags.Ephemeral,
      });
    });
  });
});
