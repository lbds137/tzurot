/**
 * Tests for Preset Create Handlers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { handleCreate, handleSeedModalSubmit } from './create.js';
import * as api from './api.js';
import * as dashboardUtils from '../../utils/dashboard/index.js';
import type { EnvConfig } from '@tzurot/common-types';
import type { ModalSubmitInteraction } from 'discord.js';

// Mock common-types
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

vi.mock('./api.js', () => ({
  createPreset: vi.fn(),
}));

vi.mock('../../utils/dashboard/index.js', () => ({
  buildDashboardEmbed: vi.fn().mockReturnValue({ data: {} }),
  buildDashboardComponents: vi.fn().mockReturnValue([]),
  buildDashboardCustomId: vi.fn().mockReturnValue('preset::seed'),
  extractModalValues: vi.fn(),
  getSessionManager: vi.fn().mockReturnValue({
    set: vi.fn(),
  }),
}));

describe('Preset Create', () => {
  const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;

  describe('handleCreate', () => {
    const mockContext = {
      showModal: vi.fn(),
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should show modal for preset creation', async () => {
      await handleCreate(mockContext as unknown as Parameters<typeof handleCreate>[0]);

      expect(mockContext.showModal).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Create New Preset',
          }),
        })
      );
    });

    it('should include seed fields in modal', async () => {
      await handleCreate(mockContext as unknown as Parameters<typeof handleCreate>[0]);

      const modalBuilder = vi.mocked(mockContext.showModal).mock.calls[0][0] as {
        toJSON: () => { components: Array<{ components: Array<{ custom_id: string }> }> };
      };
      const modalData = modalBuilder.toJSON();
      const fieldIds = modalData.components.flatMap(row => row.components.map(c => c.custom_id));

      expect(fieldIds).toContain('name');
      expect(fieldIds).toContain('model');
    });
  });

  describe('handleSeedModalSubmit', () => {
    const createMockModalInteraction = (values: Record<string, string>) =>
      ({
        user: { id: 'user-123' },
        channelId: 'channel-123',
        deferReply: vi.fn(),
        editReply: vi.fn().mockResolvedValue({ id: 'message-123' }),
        fields: {
          getTextInputValue: vi.fn((id: string) => values[id] ?? ''),
        },
      }) as unknown as ModalSubmitInteraction;

    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should defer reply with ephemeral flag', async () => {
      vi.mocked(dashboardUtils.extractModalValues).mockReturnValue({
        name: 'Test Preset',
        model: 'anthropic/claude-sonnet-4',
      });

      vi.mocked(api.createPreset).mockResolvedValue({
        id: 'preset-123',
        name: 'Test Preset',
        description: null,
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        visionModel: null,
        isGlobal: false,
        isOwned: true,
        permissions: { canEdit: true, canDelete: true },
        maxReferencedMessages: 100,
        contextWindowTokens: 8192,
        memoryScoreThreshold: null,
        memoryLimit: null,
        maxMessages: 50,
        maxAge: null,
        maxImages: 10,
        params: {},
      });

      const mockInteraction = createMockModalInteraction({
        name: 'Test Preset',
        model: 'anthropic/claude-sonnet-4',
      });

      await handleSeedModalSubmit(mockInteraction, mockConfig);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should reject empty name', async () => {
      vi.mocked(dashboardUtils.extractModalValues).mockReturnValue({
        name: '',
        model: 'anthropic/claude-sonnet-4',
      });

      const mockInteraction = createMockModalInteraction({
        name: '',
        model: 'anthropic/claude-sonnet-4',
      });

      await handleSeedModalSubmit(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith('❌ Preset name is required.');
      expect(api.createPreset).not.toHaveBeenCalled();
    });

    it('should reject empty model', async () => {
      vi.mocked(dashboardUtils.extractModalValues).mockReturnValue({
        name: 'Test Preset',
        model: '',
      });

      const mockInteraction = createMockModalInteraction({
        name: 'Test Preset',
        model: '',
      });

      await handleSeedModalSubmit(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith('❌ Model ID is required.');
      expect(api.createPreset).not.toHaveBeenCalled();
    });

    it('should create preset and show dashboard on success', async () => {
      const mockPreset = {
        id: 'preset-123',
        name: 'My Preset',
        description: null,
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        visionModel: null,
        isGlobal: false,
        isOwned: true,
        permissions: { canEdit: true, canDelete: true },
        maxReferencedMessages: 100,
        contextWindowTokens: 8192,
        memoryScoreThreshold: null,
        memoryLimit: null,
        maxMessages: 50,
        maxAge: null,
        maxImages: 10,
        params: {},
      };

      vi.mocked(dashboardUtils.extractModalValues).mockReturnValue({
        name: 'My Preset',
        model: 'anthropic/claude-sonnet-4',
      });

      vi.mocked(api.createPreset).mockResolvedValue(mockPreset);

      const mockInteraction = createMockModalInteraction({
        name: 'My Preset',
        model: 'anthropic/claude-sonnet-4',
      });

      await handleSeedModalSubmit(mockInteraction, mockConfig);

      expect(api.createPreset).toHaveBeenCalledWith(
        {
          name: 'My Preset',
          model: 'anthropic/claude-sonnet-4',
          provider: 'openrouter',
        },
        'user-123',
        mockConfig
      );

      // Dashboard should be built
      expect(dashboardUtils.buildDashboardEmbed).toHaveBeenCalled();
      expect(dashboardUtils.buildDashboardComponents).toHaveBeenCalled();

      // Session should be created
      const mockSessionManager = vi.mocked(dashboardUtils.getSessionManager)();
      expect(mockSessionManager.set).toHaveBeenCalledWith({
        userId: 'user-123',
        entityType: 'preset',
        entityId: 'preset-123',
        data: expect.any(Object),
        messageId: 'message-123',
        channelId: 'channel-123',
      });
    });

    it('should handle duplicate name error', async () => {
      vi.mocked(dashboardUtils.extractModalValues).mockReturnValue({
        name: 'Duplicate',
        model: 'anthropic/claude-sonnet-4',
      });

      vi.mocked(api.createPreset).mockRejectedValue(new Error('409 - Conflict'));

      const mockInteraction = createMockModalInteraction({
        name: 'Duplicate',
        model: 'anthropic/claude-sonnet-4',
      });

      await handleSeedModalSubmit(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.stringContaining('already exists')
      );
    });

    it('should handle generic API errors', async () => {
      vi.mocked(dashboardUtils.extractModalValues).mockReturnValue({
        name: 'Test',
        model: 'anthropic/claude-sonnet-4',
      });

      vi.mocked(api.createPreset).mockRejectedValue(new Error('Network error'));

      const mockInteraction = createMockModalInteraction({
        name: 'Test',
        model: 'anthropic/claude-sonnet-4',
      });

      await handleSeedModalSubmit(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        '❌ Failed to create preset. Please try again.'
      );
    });
  });
});
