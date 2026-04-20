/**
 * Tests for Dashboard Refresh Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { createRefreshHandler, refreshDashboardUI } from './refreshHandler.js';
import * as SessionManagerModule from './SessionManager.js';
import * as DashboardBuilderModule from './DashboardBuilder.js';
import type { DashboardConfig } from './types.js';

// Mock dependencies
vi.mock('./SessionManager.js', () => ({
  getSessionManager: vi.fn(),
}));

vi.mock('./DashboardBuilder.js', () => ({
  buildDashboardEmbed: vi.fn(),
  buildDashboardComponents: vi.fn(),
}));

// Mock renderTerminalScreen so the NOT_FOUND branch can be asserted directly
// on the call shape (session + content) rather than on the internal
// editReply/sessionManager.delete calls it performs.
const mockRenderTerminalScreen = vi.fn();
vi.mock('./terminalScreen.js', () => ({
  renderTerminalScreen: (...args: unknown[]) => mockRenderTerminalScreen(...args),
}));

describe('refreshHandler', () => {
  const mockSessionManager = {
    get: vi.fn(),
    set: vi.fn(),
  };

  const mockEmbed = { toJSON: () => ({ title: 'Test' }) };
  const mockComponents = [{ type: 1 }];

  const mockConfig: DashboardConfig<{ name: string }> = {
    entityType: 'test',
    getTitle: () => 'Test Dashboard',
    sections: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRenderTerminalScreen.mockReset();
    mockSessionManager.get.mockReset();
    // Default: no existing session. Individual tests override when they need
    // an existing browseContext.
    mockSessionManager.get.mockResolvedValue(null);
    vi.mocked(SessionManagerModule.getSessionManager).mockReturnValue(
      mockSessionManager as unknown as SessionManagerModule.DashboardSessionManager
    );
    vi.mocked(DashboardBuilderModule.buildDashboardEmbed).mockReturnValue(mockEmbed as never);
    vi.mocked(DashboardBuilderModule.buildDashboardComponents).mockReturnValue(
      mockComponents as never
    );
  });

  describe('createRefreshHandler', () => {
    it('should create a handler that fetches and updates dashboard', async () => {
      const rawData = { id: '123', name: 'Test' };
      const transformedData = { name: 'Transformed Test' };
      const fetchFn = vi.fn().mockResolvedValue(rawData);
      const transformFn = vi.fn().mockReturnValue(transformedData);

      const handler = createRefreshHandler({
        entityType: 'persona',
        dashboardConfig: mockConfig,
        fetchFn,
        transformFn,
      });

      const interaction = {
        user: { id: 'user-123', username: 'testuser', globalName: 'Test User' },
        message: { id: 'msg-456' },
        channelId: 'channel-789',
        deferUpdate: vi.fn(),
        editReply: vi.fn(),
      } as unknown as ButtonInteraction;

      await handler(interaction, 'entity-abc');

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(fetchFn).toHaveBeenCalledWith('entity-abc', {
        discordId: 'user-123',
        username: 'testuser',
        displayName: 'Test User',
      });
      expect(transformFn).toHaveBeenCalledWith(rawData);
      expect(mockSessionManager.set).toHaveBeenCalledWith({
        userId: 'user-123',
        entityType: 'persona',
        entityId: 'entity-abc',
        data: transformedData,
        messageId: 'msg-456',
        channelId: 'channel-789',
      });
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [mockEmbed],
        components: mockComponents,
      });
    });

    it('should route NOT_FOUND through renderTerminalScreen so Back-to-Browse is preserved', async () => {
      const fetchFn = vi.fn().mockResolvedValue(null);

      const handler = createRefreshHandler({
        entityType: 'persona',
        dashboardConfig: mockConfig,
        fetchFn,
        entityLabel: 'Persona',
      });

      const interaction = {
        user: { id: 'user-123' },
        deferUpdate: vi.fn(),
        editReply: vi.fn(),
      } as unknown as ButtonInteraction;

      await handler(interaction, 'entity-abc');

      expect(mockRenderTerminalScreen).toHaveBeenCalledWith(
        expect.objectContaining({
          session: expect.objectContaining({
            entityType: 'persona',
            entityId: 'entity-abc',
            browseContext: undefined,
          }),
          content: expect.stringContaining('Persona not found'),
        })
      );
    });

    it('should carry existing browseContext into the NOT_FOUND terminal screen', async () => {
      const browseContext = { page: 2, filter: 'all', sort: 'name' };
      mockSessionManager.get.mockResolvedValue({
        data: { browseContext },
      });
      const fetchFn = vi.fn().mockResolvedValue(null);

      const handler = createRefreshHandler({
        entityType: 'persona',
        dashboardConfig: mockConfig,
        fetchFn,
        entityLabel: 'Persona',
      });

      const interaction = {
        user: { id: 'user-123' },
        deferUpdate: vi.fn(),
        editReply: vi.fn(),
      } as unknown as ButtonInteraction;

      await handler(interaction, 'entity-abc');

      expect(mockRenderTerminalScreen).toHaveBeenCalledWith(
        expect.objectContaining({
          session: expect.objectContaining({ browseContext }),
        })
      );
    });

    it('should use buildOptions when provided', async () => {
      const data = { name: 'Test' };
      const fetchFn = vi.fn().mockResolvedValue(data);
      const buildOptions = vi.fn().mockReturnValue({ showClose: true, showRefresh: true });

      const handler = createRefreshHandler({
        entityType: 'preset',
        dashboardConfig: mockConfig,
        fetchFn,
        buildOptions,
      });

      const interaction = {
        user: { id: 'user-123' },
        message: { id: 'msg-456' },
        channelId: 'channel-789',
        deferUpdate: vi.fn(),
        editReply: vi.fn(),
      } as unknown as ButtonInteraction;

      await handler(interaction, 'entity-abc');

      expect(buildOptions).toHaveBeenCalledWith(data);
      expect(DashboardBuilderModule.buildDashboardComponents).toHaveBeenCalledWith(
        mockConfig,
        'entity-abc',
        data,
        { showClose: true, showRefresh: true }
      );
    });

    it('should work without transform function', async () => {
      const data = { name: 'Test' };
      const fetchFn = vi.fn().mockResolvedValue(data);

      const handler = createRefreshHandler({
        entityType: 'persona',
        dashboardConfig: mockConfig,
        fetchFn,
        // No transformFn
      });

      const interaction = {
        user: { id: 'user-123' },
        message: { id: 'msg-456' },
        channelId: 'channel-789',
        deferUpdate: vi.fn(),
        editReply: vi.fn(),
      } as unknown as ButtonInteraction;

      await handler(interaction, 'entity-abc');

      expect(mockSessionManager.set).toHaveBeenCalledWith(expect.objectContaining({ data }));
    });
  });

  describe('refreshDashboardUI', () => {
    it('should build and update dashboard', async () => {
      const data = { name: 'Test' };
      const interaction = {
        editReply: vi.fn(),
      } as unknown as ModalSubmitInteraction;

      await refreshDashboardUI({
        interaction,
        entityId: 'entity-123',
        data,
        dashboardConfig: mockConfig,
      });

      expect(DashboardBuilderModule.buildDashboardEmbed).toHaveBeenCalledWith(mockConfig, data);
      expect(DashboardBuilderModule.buildDashboardComponents).toHaveBeenCalledWith(
        mockConfig,
        'entity-123',
        data,
        undefined
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [mockEmbed],
        components: mockComponents,
      });
    });

    it('should use buildOptions when provided', async () => {
      const data = { name: 'Test' };
      const buildOptions = vi.fn().mockReturnValue({ showDelete: true });
      const interaction = {
        editReply: vi.fn(),
      } as unknown as ModalSubmitInteraction;

      await refreshDashboardUI({
        interaction,
        entityId: 'entity-123',
        data,
        dashboardConfig: mockConfig,
        buildOptions,
      });

      expect(buildOptions).toHaveBeenCalledWith(data);
      expect(DashboardBuilderModule.buildDashboardComponents).toHaveBeenCalledWith(
        mockConfig,
        'entity-123',
        data,
        { showDelete: true }
      );
    });
  });
});
