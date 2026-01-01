/**
 * Tests for Admin Settings Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import { handleSettings } from './settings.js';

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
    BotSettingKeys: {
      EXTENDED_CONTEXT_DEFAULT: 'extended_context_default',
    },
  };
});

const mockAdminFetch = vi.fn();
const mockAdminPutJson = vi.fn();
vi.mock('../../utils/adminApiClient.js', () => ({
  adminFetch: (...args: unknown[]) => mockAdminFetch(...args),
  adminPutJson: (...args: unknown[]) => mockAdminPutJson(...args),
}));

describe('Admin Settings Subcommand', () => {
  const createMockInteraction = (
    action: string
  ): ChatInputCommandInteraction & {
    reply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    deferred: boolean;
    replied: boolean;
  } => {
    return {
      options: {
        getString: vi.fn().mockReturnValue(action),
      },
      user: { id: 'user-456' },
      reply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      // Top-level interactionCreate handler already defers
      deferred: true,
      replied: false,
    } as unknown as ChatInputCommandInteraction & {
      reply: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
      deferred: boolean;
      replied: boolean;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extended-context-enable action', () => {
    it('should enable extended context globally', async () => {
      const interaction = createMockInteraction('extended-context-enable');
      mockAdminPutJson.mockResolvedValue({ ok: true });

      await handleSettings(interaction);

      // Note: deferReply is handled by top-level interactionCreate handler
      expect(mockAdminPutJson).toHaveBeenCalledWith('/admin/settings/extended_context_default', {
        value: 'true',
        description: 'Default extended context setting for channels without explicit override',
      });
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Extended context enabled globally'),
      });
    });

    it('should handle API error', async () => {
      const interaction = createMockInteraction('extended-context-enable');
      mockAdminPutJson.mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Server error'),
      });

      await handleSettings(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Failed to update setting: Server error',
      });
    });
  });

  describe('extended-context-disable action', () => {
    it('should disable extended context globally', async () => {
      const interaction = createMockInteraction('extended-context-disable');
      mockAdminPutJson.mockResolvedValue({ ok: true });

      await handleSettings(interaction);

      // Note: deferReply is handled by top-level interactionCreate handler
      expect(mockAdminPutJson).toHaveBeenCalledWith('/admin/settings/extended_context_default', {
        value: 'false',
        description: 'Default extended context setting for channels without explicit override',
      });
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Extended context disabled globally'),
      });
    });

    it('should handle API error', async () => {
      const interaction = createMockInteraction('extended-context-disable');
      mockAdminPutJson.mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Server error'),
      });

      await handleSettings(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Failed to update setting: Server error',
      });
    });
  });

  describe('list action', () => {
    it('should list all bot settings', async () => {
      const interaction = createMockInteraction('list');
      mockAdminFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          settings: [
            {
              id: 'setting-1',
              key: 'extended_context_default',
              value: 'true',
              description: 'Default extended context setting',
              updatedAt: '2025-01-15T00:00:00.000Z',
            },
          ],
        }),
      });

      await handleSettings(interaction);

      // Note: deferReply is handled by top-level interactionCreate handler
      expect(mockAdminFetch).toHaveBeenCalledWith('/admin/settings', { method: 'GET' });
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('extended_context_default'),
      });
    });

    it('should show message when no settings configured', async () => {
      const interaction = createMockInteraction('list');
      mockAdminFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ settings: [] }),
      });

      await handleSettings(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '**Bot Settings**\n\nNo settings configured yet.',
      });
    });

    it('should handle settings without description', async () => {
      const interaction = createMockInteraction('list');
      mockAdminFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          settings: [
            {
              id: 'setting-1',
              key: 'some_setting',
              value: 'value',
              description: null,
              updatedAt: '2025-01-15T00:00:00.000Z',
            },
          ],
        }),
      });

      await handleSettings(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('No description'),
      });
    });

    it('should handle API error', async () => {
      const interaction = createMockInteraction('list');
      mockAdminFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Server error'),
      });

      await handleSettings(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Failed to list settings: Server error',
      });
    });
  });

  describe('unknown action', () => {
    it('should reply with unknown action message', async () => {
      const interaction = createMockInteraction('invalid-action');

      await handleSettings(interaction);

      // Uses editReply since top-level handler already deferred
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Unknown action: invalid-action',
      });
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors with editReply', async () => {
      const interaction = createMockInteraction('extended-context-enable');
      mockAdminPutJson.mockRejectedValue(new Error('Network error'));

      await handleSettings(interaction);

      // Uses editReply since top-level handler already deferred
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'An error occurred while processing your request.',
      });
    });

    it('should not respond again if already replied', async () => {
      const interaction = createMockInteraction('extended-context-enable');
      // Simulate already having replied
      Object.defineProperty(interaction, 'replied', {
        get: () => true,
        configurable: true,
      });
      mockAdminPutJson.mockRejectedValue(new Error('Network error'));

      await handleSettings(interaction);

      // Should not call editReply again since already replied
      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });
});
