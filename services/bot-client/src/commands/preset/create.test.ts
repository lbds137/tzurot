/**
 * Tests for Preset Create Handlers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { handleCreate, handleSeedModalSubmit } from './create.js';
import * as api from './api.js';
import * as dashboardUtils from '../../utils/dashboard/index.js';
import type { ModalSubmitInteraction } from 'discord.js';

// Mock common-types
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

vi.mock('./api.js', async () => {
  const actual = await vi.importActual('./api.js');
  return {
    ...(actual as Record<string, unknown>),
    createPreset: vi.fn(),
  };
});

// Sentinel userClient flowing from `clientsFor(interaction)` into `createPreset`.
const TEST_USER_CLIENT = { actor: 'user-123' };
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: TEST_USER_CLIENT, ownerClient: { actor: 'owner' } })),
}));

vi.mock('../../utils/dashboard/index.js', () => ({
  buildDashboardEmbed: vi.fn().mockReturnValue({ data: {} }),
  buildDashboardComponents: vi.fn().mockReturnValue([]),
  buildDashboardCustomId: vi.fn((...parts: (string | undefined)[]) =>
    parts.filter(Boolean).join('::')
  ),
  extractModalValues: vi.fn(),
  getSessionManager: vi.fn().mockReturnValue({
    set: vi.fn(),
  }),
}));

describe('Preset Create', () => {
  describe('handleCreate', () => {
    // /preset create has no kind/slot option — a preset's vision-capability is
    // derived from its model, not chosen at creation. handleCreate just shows
    // the seed modal.
    const mockContext = {
      showModal: vi.fn(),
      interaction: { options: { getString: vi.fn().mockReturnValue(null) } },
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

    it('builds the seed custom-ID without a kind segment', async () => {
      await handleCreate(mockContext as unknown as Parameters<typeof handleCreate>[0]);

      // No 3rd segment — the kind/slot is no longer chosen at creation.
      expect(dashboardUtils.buildDashboardCustomId).toHaveBeenCalledWith('preset', 'seed');
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
        followUp: vi.fn().mockResolvedValue(undefined),
        deferred: true,
        replied: false,
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
        provider: 'openrouter',
      });

      vi.mocked(api.createPreset).mockResolvedValue({
        id: 'preset-123',
        name: 'Test Preset',
        description: null,
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        isGlobal: false,
        isOwned: true,
        permissions: { canEdit: true, canDelete: true },
        contextWindowTokens: 8192,
        params: {},
      });

      const mockInteraction = createMockModalInteraction({
        name: 'Test Preset',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
      });

      await handleSeedModalSubmit(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should reject empty name', async () => {
      vi.mocked(dashboardUtils.extractModalValues).mockReturnValue({
        name: '',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
      });

      const mockInteraction = createMockModalInteraction({
        name: '',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
      });

      await handleSeedModalSubmit(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ Preset name is required.',
      });
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

      await handleSeedModalSubmit(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ Model ID is required.',
      });
      expect(api.createPreset).not.toHaveBeenCalled();
    });

    it('should create preset and show dashboard on success', async () => {
      const mockPreset = {
        id: 'preset-123',
        name: 'My Preset',
        description: null,
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        isGlobal: false,
        isOwned: true,
        permissions: { canEdit: true, canDelete: true },
        contextWindowTokens: 8192,
        params: {},
      };

      vi.mocked(dashboardUtils.extractModalValues).mockReturnValue({
        name: 'My Preset',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
      });

      vi.mocked(api.createPreset).mockResolvedValue(mockPreset);

      const mockInteraction = createMockModalInteraction({
        name: 'My Preset',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
      });

      await handleSeedModalSubmit(mockInteraction);

      expect(api.createPreset).toHaveBeenCalledWith(
        {
          name: 'My Preset',
          model: 'anthropic/claude-sonnet-4',
          provider: 'openrouter',
          // No kind sent — the server defaults it; capability is model-derived.
        },
        TEST_USER_CLIENT
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
        provider: 'openrouter',
      });

      vi.mocked(api.createPreset).mockRejectedValue(
        new Error('Failed to create preset: 409 - You already have a config named "Duplicate"')
      );

      const mockInteraction = createMockModalInteraction({
        name: 'Duplicate',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
      });

      await handleSeedModalSubmit(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('already exists'),
      });
    });

    it('should handle generic API errors', async () => {
      vi.mocked(dashboardUtils.extractModalValues).mockReturnValue({
        name: 'Test',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
      });

      vi.mocked(api.createPreset).mockRejectedValue(new Error('Network error'));

      const mockInteraction = createMockModalInteraction({
        name: 'Test',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
      });

      await handleSeedModalSubmit(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ Failed to create preset. Please try again.',
      });
    });

    it('should surface API validation error when create fails with structured error', async () => {
      vi.mocked(dashboardUtils.extractModalValues).mockReturnValue({
        name: 'Test',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
      });

      vi.mocked(api.createPreset).mockRejectedValue(
        new Error(
          'Failed to create preset: 400 - contextWindowTokens (131072) exceeds 50% of the model context window'
        )
      );

      const mockInteraction = createMockModalInteraction({
        name: 'Test',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
      });

      await handleSeedModalSubmit(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ contextWindowTokens (131072) exceeds 50% of the model context window',
      });
    });
  });
});
