/**
 * Tests for Admin Settings Dashboard
 *
 * Tests the interactive settings dashboard for admin settings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import {
  handleSettings,
  handleAdminSettingsButton,
  handleAdminSettingsSelectMenu,
  isAdminSettingsInteraction,
} from './settings.js';

// Mock dependencies
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

const mockAdminFetch = vi.fn();
const mockAdminPatchJson = vi.fn();
vi.mock('../../utils/adminApiClient.js', () => ({
  adminFetch: (...args: unknown[]) => mockAdminFetch(...args),
  adminPatchJson: (...args: unknown[]) => mockAdminPatchJson(...args),
}));

// Mock the session manager
const mockSessionManager = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../utils/dashboard/SessionManager.js', () => ({
  getSessionManager: vi.fn(() => mockSessionManager),
  DashboardSessionManager: {
    getInstance: vi.fn(() => mockSessionManager),
  },
}));

describe('Admin Settings Dashboard', () => {
  const mockSettings = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    updatedBy: 'user-123',
    createdAt: '2025-01-15T00:00:00.000Z',
    updatedAt: '2025-01-15T00:00:00.000Z',
    extendedContextDefault: true,
    extendedContextMaxMessages: 50,
    extendedContextMaxAge: 7200, // 2 hours in seconds
    extendedContextMaxImages: 5,
  };

  const createMockInteraction = (): ChatInputCommandInteraction & {
    reply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    deferred: boolean;
    replied: boolean;
  } => {
    return {
      options: {
        getString: vi.fn(),
        getInteger: vi.fn(),
      },
      user: { id: 'user-456' },
      reply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue({ id: 'message-123' }),
      deferred: true,
      replied: false,
    } as unknown as ChatInputCommandInteraction & {
      reply: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
      deferred: boolean;
      replied: boolean;
    };
  };

  const createMockButtonInteraction = (
    customId: string
  ): ButtonInteraction & {
    deferUpdate: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    message: { id: string };
  } => {
    return {
      customId,
      user: { id: 'user-456' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      message: { id: 'message-123' },
    } as unknown as ButtonInteraction & {
      deferUpdate: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
      message: { id: string };
    };
  };

  const createMockSelectMenuInteraction = (
    customId: string,
    value: string
  ): StringSelectMenuInteraction & {
    deferUpdate: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    message: { id: string };
    values: string[];
  } => {
    return {
      customId,
      user: { id: 'user-456' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      message: { id: 'message-123' },
      values: [value],
    } as unknown as StringSelectMenuInteraction & {
      deferUpdate: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
      message: { id: string };
      values: string[];
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleSettings', () => {
    it('should display settings dashboard embed', async () => {
      const interaction = createMockInteraction();
      mockAdminFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSettings),
      });

      await handleSettings(interaction);

      expect(mockAdminFetch).toHaveBeenCalledWith('/admin/settings', {
        method: 'GET',
        userId: 'user-456',
      });
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('should include Global Settings title in embed', async () => {
      const interaction = createMockInteraction();
      mockAdminFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSettings),
      });

      await handleSettings(interaction);

      const editReplyCall = interaction.editReply.mock.calls[0][0];
      expect(editReplyCall.embeds).toHaveLength(1);

      const embedJson = editReplyCall.embeds[0].toJSON();
      expect(embedJson.title).toBe('Global Settings');
    });

    it('should include all 4 settings fields', async () => {
      const interaction = createMockInteraction();
      mockAdminFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSettings),
      });

      await handleSettings(interaction);

      const editReplyCall = interaction.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      expect(embedJson.fields).toHaveLength(4);
      expect(embedJson.fields.map((f: { name: string }) => f.name)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Extended Context'),
          expect.stringContaining('Max Messages'),
          expect.stringContaining('Max Age'),
          expect.stringContaining('Max Images'),
        ])
      );
    });

    it('should show enabled status correctly', async () => {
      const interaction = createMockInteraction();
      mockAdminFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ ...mockSettings, extendedContextDefault: true }),
      });

      await handleSettings(interaction);

      const editReplyCall = interaction.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();
      const enabledField = embedJson.fields.find((f: { name: string }) =>
        f.name.includes('Extended Context')
      );

      expect(enabledField.value).toContain('Enabled');
    });

    it('should show disabled status correctly', async () => {
      const interaction = createMockInteraction();
      mockAdminFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ ...mockSettings, extendedContextDefault: false }),
      });

      await handleSettings(interaction);

      const editReplyCall = interaction.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();
      const enabledField = embedJson.fields.find((f: { name: string }) =>
        f.name.includes('Extended Context')
      );

      expect(enabledField.value).toContain('Disabled');
    });

    it('should include select menu and close button', async () => {
      const interaction = createMockInteraction();
      mockAdminFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSettings),
      });

      await handleSettings(interaction);

      const editReplyCall = interaction.editReply.mock.calls[0][0];
      expect(editReplyCall.components).toHaveLength(2);
    });

    it('should handle fetch failure gracefully', async () => {
      const interaction = createMockInteraction();
      mockAdminFetch.mockResolvedValue({
        ok: false,
        json: vi.fn(),
      });

      await handleSettings(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Failed to fetch admin settings.',
      });
    });

    it('should handle unexpected errors gracefully', async () => {
      const interaction = createMockInteraction();
      mockAdminFetch.mockRejectedValue(new Error('Network error'));

      await handleSettings(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'An error occurred while opening the settings dashboard.',
      });
    });

    it('should not respond again if already replied', async () => {
      const interaction = createMockInteraction();
      Object.defineProperty(interaction, 'replied', {
        get: () => true,
        configurable: true,
      });
      mockAdminFetch.mockRejectedValue(new Error('Network error'));

      await handleSettings(interaction);

      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });

  describe('isAdminSettingsInteraction', () => {
    it('should return true for admin settings custom IDs', () => {
      expect(isAdminSettingsInteraction('admin-settings::select::global')).toBe(true);
      expect(isAdminSettingsInteraction('admin-settings::set::global::enabled:true')).toBe(true);
      expect(isAdminSettingsInteraction('admin-settings::back::global')).toBe(true);
      expect(isAdminSettingsInteraction('admin-settings::close::global')).toBe(true);
    });

    it('should return false for non-admin settings custom IDs', () => {
      expect(isAdminSettingsInteraction('channel-context::select::chan-123')).toBe(false);
      expect(isAdminSettingsInteraction('personality-settings::set::aurora')).toBe(false);
      expect(isAdminSettingsInteraction('character::edit::my-char')).toBe(false);
    });

    it('should return false for empty custom ID', () => {
      expect(isAdminSettingsInteraction('')).toBe(false);
    });
  });

  describe('handleAdminSettingsButton', () => {
    it('should ignore non-admin-settings interactions', async () => {
      const interaction = createMockButtonInteraction(
        'channel-context::set::chan-123::enabled:true'
      );

      await handleAdminSettingsButton(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });
  });

  describe('handleAdminSettingsSelectMenu', () => {
    it('should ignore non-admin-settings interactions', async () => {
      const interaction = createMockSelectMenuInteraction(
        'channel-context::select::chan-123',
        'enabled'
      );

      await handleAdminSettingsSelectMenu(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });
  });
});
