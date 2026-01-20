/**
 * Tests for Preset Global Edit Handler (Dashboard Pattern)
 *
 * Tests /preset global edit subcommand:
 * - Opens dashboard for global preset editing
 * - Proper error handling for not found
 * - Session management for dashboard
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { handleGlobalEdit } from './edit.js';
import type { PresetData } from '../config.js';

// Mock common-types logger
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock api.ts
const mockFetchGlobalPreset = vi.fn();
vi.mock('../api.js', () => ({
  fetchGlobalPreset: (...args: unknown[]) => mockFetchGlobalPreset(...args),
}));

// Mock dashboard utilities
const mockBuildDashboardEmbed = vi.fn().mockReturnValue({ title: 'Test Embed' });
const mockBuildDashboardComponents = vi.fn().mockReturnValue([]);
const mockSessionManagerSet = vi.fn();
const mockGetSessionManager = vi.fn().mockReturnValue({
  set: mockSessionManagerSet,
});
vi.mock('../../../utils/dashboard/index.js', () => ({
  buildDashboardEmbed: (...args: unknown[]) => mockBuildDashboardEmbed(...args),
  buildDashboardComponents: (...args: unknown[]) => mockBuildDashboardComponents(...args),
  getSessionManager: () => mockGetSessionManager(),
}));

const mockGlobalPresetData: PresetData = {
  id: 'global-preset-123',
  name: 'Global Test Preset',
  description: 'A global test preset',
  provider: 'openrouter',
  model: 'anthropic/claude-sonnet-4',
  visionModel: null,
  isGlobal: true,
  isOwned: false,
  permissions: { canEdit: true, canDelete: true }, // Bot owner can edit global presets
  maxReferencedMessages: 20,
  params: {
    temperature: 0.8,
    top_p: 0.95,
  },
};

describe('Preset Global Edit Handler', () => {
  const mockDeferReply = vi.fn();
  const mockEditReply = vi.fn().mockResolvedValue({ id: 'message-789' });

  function createMockInteraction(configId = 'global-preset-123') {
    return {
      user: { id: 'owner-123' },
      channelId: 'channel-999',
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'config') {
            return configId;
          }
          return null;
        },
      },
      deferReply: mockDeferReply,
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleGlobalEdit>[0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleGlobalEdit', () => {
    it('should open dashboard for global preset', async () => {
      mockFetchGlobalPreset.mockResolvedValue(mockGlobalPresetData);

      await handleGlobalEdit(createMockInteraction());

      expect(mockDeferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(mockFetchGlobalPreset).toHaveBeenCalledWith('global-preset-123');
      expect(mockBuildDashboardEmbed).toHaveBeenCalled();
      expect(mockBuildDashboardComponents).toHaveBeenCalledWith(
        expect.anything(),
        'global-preset-123',
        expect.objectContaining({ id: 'global-preset-123', name: 'Global Test Preset' }),
        { showClose: true, showRefresh: true }
      );
      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [{ title: 'Test Embed' }],
        components: [],
      });
      expect(mockSessionManagerSet).toHaveBeenCalledWith({
        userId: 'owner-123',
        entityType: 'preset',
        entityId: 'global-preset-123',
        data: expect.objectContaining({
          id: 'global-preset-123',
          isGlobal: true,
        }),
        messageId: 'message-789',
        channelId: 'channel-999',
      });
    });

    it('should show error when global preset not found', async () => {
      mockFetchGlobalPreset.mockResolvedValue(null);

      await handleGlobalEdit(createMockInteraction());

      expect(mockEditReply).toHaveBeenCalledWith('❌ Global preset not found.');
      expect(mockBuildDashboardEmbed).not.toHaveBeenCalled();
      expect(mockSessionManagerSet).not.toHaveBeenCalled();
    });

    it('should handle fetch errors gracefully', async () => {
      mockFetchGlobalPreset.mockRejectedValue(new Error('Network error'));

      await handleGlobalEdit(createMockInteraction());

      expect(mockEditReply).toHaveBeenCalledWith(
        '❌ Failed to load global preset. Please try again.'
      );
      expect(mockBuildDashboardEmbed).not.toHaveBeenCalled();
      expect(mockSessionManagerSet).not.toHaveBeenCalled();
    });

    it('should flatten preset data correctly for dashboard', async () => {
      mockFetchGlobalPreset.mockResolvedValue(mockGlobalPresetData);

      await handleGlobalEdit(createMockInteraction());

      // Verify the flattened data passed to dashboard embed includes expected fields
      expect(mockBuildDashboardEmbed).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'global-preset-123',
          name: 'Global Test Preset',
          provider: 'openrouter',
          model: 'anthropic/claude-sonnet-4',
          isGlobal: true,
          isOwned: false,
          temperature: '0.8',
          top_p: '0.95',
        })
      );
    });
  });
});
