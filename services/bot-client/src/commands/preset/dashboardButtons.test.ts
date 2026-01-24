/**
 * Tests for Preset Dashboard Button Handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import {
  buildPresetDashboardOptions,
  handleCloseButton,
  handleRefreshButton,
  handleToggleGlobalButton,
  handleDeleteButton,
  handleConfirmDeleteButton,
  handleCancelDeleteButton,
  handleCloneButton,
} from './dashboardButtons.js';
import type { FlattenedPresetData } from './config.js';

// Mock dependencies
const mockFetchPreset = vi.fn();
const mockFetchGlobalPreset = vi.fn();
const mockUpdatePreset = vi.fn();
const mockCreatePreset = vi.fn();

vi.mock('./api.js', () => ({
  fetchPreset: (...args: unknown[]) => mockFetchPreset(...args),
  fetchGlobalPreset: (...args: unknown[]) => mockFetchGlobalPreset(...args),
  updatePreset: (...args: unknown[]) => mockUpdatePreset(...args),
  createPreset: (...args: unknown[]) => mockCreatePreset(...args),
}));

const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

const mockSessionManager = {
  get: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../utils/dashboard/index.js', async () => {
  const actual = await vi.importActual('../../utils/dashboard/index.js');
  return {
    ...actual,
    getSessionManager: () => mockSessionManager,
  };
});

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    getConfig: () => ({ GATEWAY_URL: 'http://localhost:3000' }),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('Preset Dashboard Buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager.get.mockResolvedValue(null);
    mockSessionManager.set.mockResolvedValue(undefined);
    mockSessionManager.delete.mockResolvedValue(undefined);
  });

  const createMockFlattenedPreset = (
    overrides?: Partial<FlattenedPresetData>
  ): FlattenedPresetData => ({
    id: 'preset-123',
    name: 'Test Preset',
    slug: 'test-preset',
    description: 'A test preset',
    isGlobal: false,
    isOwned: true,
    modelId: 'gpt-4',
    temperature: 0.7,
    maxTokens: 4000,
    topP: null,
    topK: null,
    frequencyPenalty: null,
    presencePenalty: null,
    ...overrides,
  });

  const createMockButtonInteraction = (customId: string) =>
    ({
      customId,
      user: { id: 'user-123' },
      message: { id: 'msg-123' },
      channelId: 'channel-123',
      update: vi.fn(),
      deferUpdate: vi.fn(),
      editReply: vi.fn(),
      reply: vi.fn(),
      followUp: vi.fn(),
    }) as unknown as ButtonInteraction;

  describe('buildPresetDashboardOptions', () => {
    it('should show delete button for owned presets', () => {
      const data = createMockFlattenedPreset({ isOwned: true });
      const options = buildPresetDashboardOptions(data);

      expect(options.showDelete).toBe(true);
      expect(options.showClone).toBe(true);
      expect(options.toggleGlobal?.isOwned).toBe(true);
    });

    it('should hide delete button for non-owned presets', () => {
      const data = createMockFlattenedPreset({ isOwned: false });
      const options = buildPresetDashboardOptions(data);

      expect(options.showDelete).toBe(false);
      expect(options.toggleGlobal?.isOwned).toBe(false);
    });

    it('should include global toggle state', () => {
      const data = createMockFlattenedPreset({ isGlobal: true, isOwned: true });
      const options = buildPresetDashboardOptions(data);

      expect(options.toggleGlobal?.isGlobal).toBe(true);
    });
  });

  describe('handleCloseButton', () => {
    it('should delete session and close dashboard', async () => {
      const mockInteraction = createMockButtonInteraction('preset::close::preset-123');

      await handleCloseButton(mockInteraction, 'preset-123');

      expect(mockSessionManager.delete).toHaveBeenCalledWith('user-123', 'preset', 'preset-123');
      expect(mockInteraction.update).toHaveBeenCalledWith({
        content: expect.stringContaining('Dashboard closed'),
        embeds: [],
        components: [],
      });
    });
  });

  // Helper to create a full preset API response
  const createMockPresetResponse = (overrides?: Record<string, unknown>) => ({
    id: 'preset-123',
    name: 'Test Preset',
    slug: 'test-preset',
    description: 'A test preset',
    provider: 'openrouter',
    model: 'gpt-4',
    visionModel: null,
    isGlobal: false,
    isOwned: true,
    permissions: { canEdit: true },
    maxReferencedMessages: 10,
    params: {
      temperature: 0.7,
      top_p: null,
      top_k: null,
      max_tokens: 4000,
      seed: null,
      frequency_penalty: null,
      presence_penalty: null,
      repetition_penalty: null,
      min_p: null,
      top_a: null,
      reasoning: null,
      show_thinking: null,
    },
    ...overrides,
  });

  describe('handleRefreshButton', () => {
    it('should refresh with user preset data', async () => {
      const mockInteraction = createMockButtonInteraction('preset::refresh::preset-123');

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({ isGlobal: false }),
      });
      mockFetchPreset.mockResolvedValue(createMockPresetResponse({ isGlobal: false }));

      await handleRefreshButton(mockInteraction, 'preset-123');

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
      expect(mockFetchPreset).toHaveBeenCalledWith('preset-123', 'user-123');
      expect(mockSessionManager.set).toHaveBeenCalled();
    });

    it('should refresh with global preset data', async () => {
      const mockInteraction = createMockButtonInteraction('preset::refresh::preset-123');

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({ isGlobal: true }),
      });
      mockFetchGlobalPreset.mockResolvedValue(
        createMockPresetResponse({
          isGlobal: true,
          isOwned: false,
          permissions: { canEdit: false },
        })
      );

      await handleRefreshButton(mockInteraction, 'preset-123');

      expect(mockFetchGlobalPreset).toHaveBeenCalledWith('preset-123');
    });

    it('should show error if preset not found', async () => {
      const mockInteraction = createMockButtonInteraction('preset::refresh::preset-123');

      mockSessionManager.get.mockResolvedValue({ data: createMockFlattenedPreset() });
      mockFetchPreset.mockResolvedValue(null);

      await handleRefreshButton(mockInteraction, 'preset-123');

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Preset not found'),
        embeds: [],
        components: [],
      });
    });
  });

  describe('handleDeleteButton', () => {
    it('should show confirmation dialog for owned preset', async () => {
      const mockInteraction = createMockButtonInteraction('preset::delete::preset-123');

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({ isOwned: true }),
      });

      await handleDeleteButton(mockInteraction, 'preset-123');

      expect(mockInteraction.update).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              title: expect.stringContaining('Delete'),
            }),
          }),
        ]),
        components: expect.any(Array),
      });
    });

    it('should reject deletion of non-owned preset', async () => {
      const mockInteraction = createMockButtonInteraction('preset::delete::preset-123');

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({ isOwned: false }),
      });

      await handleDeleteButton(mockInteraction, 'preset-123');

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('only delete presets you own'),
        flags: expect.any(Number),
      });
    });

    it('should show error if session expired', async () => {
      const mockInteraction = createMockButtonInteraction('preset::delete::preset-123');

      mockSessionManager.get.mockResolvedValue(null);

      await handleDeleteButton(mockInteraction, 'preset-123');

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('Session expired'),
        flags: expect.any(Number),
      });
    });
  });

  describe('handleConfirmDeleteButton', () => {
    it('should delete preset and show success', async () => {
      const mockInteraction = createMockButtonInteraction('preset::confirm-delete::preset-123');

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({ name: 'Preset To Delete' }),
      });
      mockCallGatewayApi.mockResolvedValue({ ok: true });

      await handleConfirmDeleteButton(mockInteraction, 'preset-123');

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/llm-config/preset-123',
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(mockSessionManager.delete).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('has been deleted'),
        embeds: [],
        components: [],
      });
    });

    it('should show error on delete failure', async () => {
      const mockInteraction = createMockButtonInteraction('preset::confirm-delete::preset-123');

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset(),
      });
      mockCallGatewayApi.mockResolvedValue({ ok: false, error: 'Database error' });

      await handleConfirmDeleteButton(mockInteraction, 'preset-123');

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to delete'),
        embeds: [],
        components: [],
      });
    });
  });

  describe('handleCancelDeleteButton', () => {
    it('should return to dashboard view', async () => {
      const mockInteraction = createMockButtonInteraction('preset::cancel-delete::preset-123');

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset(),
      });

      await handleCancelDeleteButton(mockInteraction, 'preset-123');

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalled();
    });

    it('should show error if session expired', async () => {
      const mockInteraction = createMockButtonInteraction('preset::cancel-delete::preset-123');

      mockSessionManager.get.mockResolvedValue(null);

      await handleCancelDeleteButton(mockInteraction, 'preset-123');

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Session expired'),
        embeds: [],
        components: [],
      });
    });
  });

  describe('handleCloneButton', () => {
    it('should clone preset with new name', async () => {
      const mockInteraction = createMockButtonInteraction('preset::clone::preset-123');

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({ name: 'Original Preset' }),
      });
      mockCreatePreset.mockResolvedValue({
        id: 'cloned-preset',
        name: 'Original Preset (Copy)',
        slug: 'original-preset-copy',
      });

      await handleCloneButton(mockInteraction, 'preset-123');

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
      expect(mockCreatePreset).toHaveBeenCalled();
    });

    it('should show error if session expired', async () => {
      const mockInteraction = createMockButtonInteraction('preset::clone::preset-123');

      mockSessionManager.get.mockResolvedValue(null);

      await handleCloneButton(mockInteraction, 'preset-123');

      // Uses editReply because deferUpdate was called first
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Session expired'),
        embeds: [],
        components: [],
      });
    });
  });
});
