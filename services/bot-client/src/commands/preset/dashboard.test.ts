/**
 * Tests for Preset Dashboard Interaction Handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  handleModalSubmit,
  handleSelectMenu,
  handleButton,
  isPresetDashboardInteraction,
} from './dashboard.js';
import { handleDashboardClose } from '../../utils/dashboard/closeHandler.js';
import type { PresetData } from './config.js';

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
const mockFetchPreset = vi.fn();
const mockUpdatePreset = vi.fn();
const mockFetchGlobalPreset = vi.fn();
const mockUpdateGlobalPreset = vi.fn();
const mockCreatePreset = vi.fn();
vi.mock('./api.js', () => ({
  fetchPreset: (...args: unknown[]) => mockFetchPreset(...args),
  updatePreset: (...args: unknown[]) => mockUpdatePreset(...args),
  fetchGlobalPreset: (...args: unknown[]) => mockFetchGlobalPreset(...args),
  updateGlobalPreset: (...args: unknown[]) => mockUpdateGlobalPreset(...args),
  createPreset: (...args: unknown[]) => mockCreatePreset(...args),
}));

// Mock customIds
const mockPresetCustomIdsParse = vi.fn();
vi.mock('../../utils/customIds.js', () => ({
  PresetCustomIds: {
    parse: (...args: unknown[]) => mockPresetCustomIdsParse(...args),
    menu: (id: string) => `preset::menu::${id}`,
    modal: (id: string, section: string) => `preset::modal::${id}::${section}`,
    isPreset: (customId: string) => customId.startsWith('preset::'),
  },
}));

// Mock dashboard utilities
const mockBuildDashboardEmbed = vi.fn().mockReturnValue({ title: 'Test Embed' });
const mockBuildDashboardComponents = vi.fn().mockReturnValue([]);
const mockBuildSectionModal = vi.fn().mockReturnValue({ title: 'Test Modal' });
const mockExtractModalValues = vi.fn().mockReturnValue({ name: 'Updated' });
const mockParseDashboardCustomId = vi.fn();
const mockIsDashboardInteraction = vi.fn();
const mockSessionManagerGet = vi.fn();
const mockSessionManagerSet = vi.fn();
const mockSessionManagerUpdate = vi.fn();
const mockSessionManagerDelete = vi.fn();
const mockGetSessionManager = vi.fn().mockReturnValue({
  get: mockSessionManagerGet,
  set: mockSessionManagerSet,
  update: mockSessionManagerUpdate,
  delete: mockSessionManagerDelete,
});
vi.mock('../../utils/dashboard/index.js', () => ({
  buildDashboardEmbed: (...args: unknown[]) => mockBuildDashboardEmbed(...args),
  buildDashboardComponents: (...args: unknown[]) => mockBuildDashboardComponents(...args),
  buildSectionModal: (...args: unknown[]) => mockBuildSectionModal(...args),
  extractModalValues: (...args: unknown[]) => mockExtractModalValues(...args),
  getSessionManager: () => mockGetSessionManager(),
  parseDashboardCustomId: (...args: unknown[]) => mockParseDashboardCustomId(...args),
  isDashboardInteraction: (...args: unknown[]) => mockIsDashboardInteraction(...args),
}));

vi.mock('../../utils/dashboard/closeHandler.js', () => ({
  handleDashboardClose: vi.fn().mockResolvedValue(undefined),
}));

const mockPresetData: PresetData = {
  id: 'preset-123',
  name: 'Test Preset',
  description: 'A test preset',
  provider: 'openrouter',
  model: 'anthropic/claude-sonnet-4',
  visionModel: null,
  isGlobal: false,
  isOwned: true,
  permissions: { canEdit: true, canDelete: true },
  maxReferencedMessages: 10,
  params: { temperature: 0.7 },
};

describe('isPresetDashboardInteraction', () => {
  it('should return true for dashboard-specific actions', () => {
    mockIsDashboardInteraction.mockReturnValue(true);

    // Test each dashboard action
    const dashboardActions = [
      'menu',
      'modal',
      'seed',
      'close',
      'back',
      'refresh',
      'clone',
      'toggle-global',
      'delete',
      'confirm-delete',
      'cancel-delete',
    ];

    for (const action of dashboardActions) {
      mockPresetCustomIdsParse.mockReturnValue({
        command: 'preset',
        action,
        presetId: '123',
      });

      expect(isPresetDashboardInteraction(`preset::${action}::123`)).toBe(true);
    }
  });

  it('should return false for non-preset interactions', () => {
    mockIsDashboardInteraction.mockReturnValue(false);

    const result = isPresetDashboardInteraction('character::modal::123::identity');

    expect(result).toBe(false);
  });

  it('should return false for non-dashboard preset actions', () => {
    mockIsDashboardInteraction.mockReturnValue(true);

    // Browse actions should NOT be matched
    mockPresetCustomIdsParse.mockReturnValue({
      command: 'preset',
      action: 'browse',
      presetId: undefined,
    });
    expect(isPresetDashboardInteraction('preset::browse::0::all')).toBe(false);

    mockPresetCustomIdsParse.mockReturnValue({
      command: 'preset',
      action: 'browse-select',
    });
    expect(isPresetDashboardInteraction('preset::browse-select')).toBe(false);
  });

  it('should return false if parse returns null', () => {
    mockIsDashboardInteraction.mockReturnValue(true);
    mockPresetCustomIdsParse.mockReturnValue(null);

    expect(isPresetDashboardInteraction('preset::invalid')).toBe(false);
  });
});

describe('handleModalSubmit', () => {
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();
  const mockReply = vi.fn();

  function createMockModalInteraction(customId: string) {
    return {
      customId,
      user: { id: 'user-456' },
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
      reply: mockReply,
    } as unknown as Parameters<typeof handleModalSubmit>[0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle section modal submission and update preset', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'preset',
      action: 'modal',
      entityId: 'preset-123',
      sectionId: 'identity',
    });
    mockSessionManagerGet.mockResolvedValue({
      data: { id: 'preset-123', name: 'Test', isGlobal: false, isOwned: true },
    });
    mockUpdatePreset.mockResolvedValue(mockPresetData);

    await handleModalSubmit(createMockModalInteraction('preset::modal::preset-123::identity'));

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockUpdatePreset).toHaveBeenCalledWith('preset-123', expect.any(Object), 'user-456');
    expect(mockSessionManagerUpdate).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [{ title: 'Test Embed' }],
      components: [],
    });
  });

  it('should update global preset when session indicates global', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'preset',
      action: 'modal',
      entityId: 'preset-123',
      sectionId: 'identity',
    });
    mockSessionManagerGet.mockResolvedValue({
      data: { id: 'preset-123', name: 'Test', isGlobal: true, isOwned: true },
    });
    mockUpdateGlobalPreset.mockResolvedValue(mockPresetData);

    await handleModalSubmit(createMockModalInteraction('preset::modal::preset-123::identity'));

    expect(mockUpdateGlobalPreset).toHaveBeenCalledWith('preset-123', expect.any(Object));
    expect(mockUpdatePreset).not.toHaveBeenCalled();
  });

  it('should show error for unknown modal submission', async () => {
    mockParseDashboardCustomId.mockReturnValue(null);

    await handleModalSubmit(createMockModalInteraction('unknown::modal'));

    expect(mockReply).toHaveBeenCalledWith({
      content: '❌ Unknown form submission.',
      flags: MessageFlags.Ephemeral,
    });
  });
});

describe('handleSelectMenu', () => {
  const mockShowModal = vi.fn();
  const mockReply = vi.fn();
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();

  function createMockSelectInteraction(customId: string, value: string) {
    return {
      customId,
      values: [value],
      user: { id: 'user-456' },
      channelId: 'channel-999',
      message: { id: 'message-789' },
      showModal: mockShowModal,
      reply: mockReply,
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleSelectMenu>[0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show section modal for edit selection', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'preset',
      entityId: 'preset-123',
    });
    mockSessionManagerGet.mockResolvedValue({
      data: { id: 'preset-123', isGlobal: false, isOwned: true, canEdit: true },
    });

    await handleSelectMenu(
      createMockSelectInteraction('preset::select::preset-123', 'edit-identity')
    );

    expect(mockBuildSectionModal).toHaveBeenCalled();
    expect(mockShowModal).toHaveBeenCalledWith({ title: 'Test Modal' });
  });

  it('should fetch preset if session is missing', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'preset',
      entityId: 'preset-123',
    });
    mockSessionManagerGet.mockResolvedValue(null);
    mockFetchPreset.mockResolvedValue(mockPresetData);

    await handleSelectMenu(
      createMockSelectInteraction('preset::select::preset-123', 'edit-identity')
    );

    expect(mockFetchPreset).toHaveBeenCalledWith('preset-123', 'user-456');
    expect(mockSessionManagerSet).toHaveBeenCalled();
    expect(mockShowModal).toHaveBeenCalled();
  });

  it('should show error when preset not found', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'preset',
      entityId: 'preset-123',
    });
    mockSessionManagerGet.mockResolvedValue(null);
    mockFetchPreset.mockResolvedValue(null);

    await handleSelectMenu(
      createMockSelectInteraction('preset::select::preset-123', 'edit-identity')
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: '❌ Preset not found.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should show error when user cannot edit preset', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'preset',
      entityId: 'preset-123',
    });
    mockSessionManagerGet.mockResolvedValue({
      data: { id: 'preset-123', isGlobal: false, isOwned: false, canEdit: false },
    });

    await handleSelectMenu(
      createMockSelectInteraction('preset::select::preset-123', 'edit-identity')
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: '❌ You do not have permission to edit this preset.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should show error for unknown section', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'preset',
      entityId: 'preset-123',
    });
    mockSessionManagerGet.mockResolvedValue({
      data: { id: 'preset-123', isGlobal: false, isOwned: true },
    });

    await handleSelectMenu(
      createMockSelectInteraction('preset::select::preset-123', 'edit-unknown')
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: '❌ Unknown section.',
      flags: MessageFlags.Ephemeral,
    });
  });

  // Note: Refresh action removed from dropdown (use refresh button instead)
  // handleButton tests cover refresh functionality

  it('should ignore non-preset interactions', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'character',
      entityId: 'char-123',
    });

    await handleSelectMenu(
      createMockSelectInteraction('character::select::char-123', 'edit-identity')
    );

    expect(mockShowModal).not.toHaveBeenCalled();
    expect(mockReply).not.toHaveBeenCalled();
  });
});

describe('handleButton', () => {
  const mockUpdate = vi.fn();
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();

  function createMockButtonInteraction(customId: string) {
    return {
      customId,
      user: { id: 'user-456' },
      channelId: 'channel-999',
      message: { id: 'message-789' },
      update: mockUpdate,
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleButton>[0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should delegate to shared close handler', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'preset',
      entityId: 'preset-123',
      action: 'close',
    });

    const mockInteraction = createMockButtonInteraction('preset::close::preset-123');
    await handleButton(mockInteraction);

    // Verify delegation to shared handler
    expect(handleDashboardClose).toHaveBeenCalledWith(mockInteraction, 'preset', 'preset-123');
  });

  it('should handle refresh button', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'preset',
      entityId: 'preset-123',
      action: 'refresh',
    });
    mockSessionManagerGet.mockResolvedValue({
      data: { id: 'preset-123', isGlobal: false },
    });
    mockFetchPreset.mockResolvedValue(mockPresetData);

    await handleButton(createMockButtonInteraction('preset::refresh::preset-123'));

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockFetchPreset).toHaveBeenCalledWith('preset-123', 'user-456');
    expect(mockSessionManagerSet).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [{ title: 'Test Embed' }],
      components: [],
    });
  });

  it('should try user endpoint first even when session indicates global', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'preset',
      entityId: 'preset-123',
      action: 'refresh',
    });
    mockSessionManagerGet.mockResolvedValue({
      data: { id: 'preset-123', isGlobal: true },
    });
    // User endpoint returns the global preset (it's accessible)
    mockFetchPreset.mockResolvedValue(mockPresetData);

    await handleButton(createMockButtonInteraction('preset::refresh::preset-123'));

    // Should try user endpoint first (works for accessible global presets)
    expect(mockFetchPreset).toHaveBeenCalledWith('preset-123', 'user-456');
    // Should not need to fall back to global endpoint
    expect(mockFetchGlobalPreset).not.toHaveBeenCalled();
  });

  it('should fall back to global endpoint when user endpoint returns null for global preset', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'preset',
      entityId: 'preset-123',
      action: 'refresh',
    });
    mockSessionManagerGet.mockResolvedValue({
      data: { id: 'preset-123', isGlobal: true },
    });
    // User endpoint returns null
    mockFetchPreset.mockResolvedValue(null);
    // Global endpoint returns the preset
    mockFetchGlobalPreset.mockResolvedValue(mockPresetData);

    await handleButton(createMockButtonInteraction('preset::refresh::preset-123'));

    expect(mockFetchPreset).toHaveBeenCalledWith('preset-123', 'user-456');
    expect(mockFetchGlobalPreset).toHaveBeenCalledWith('preset-123');
  });

  it('should show error when preset not found on refresh', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'preset',
      entityId: 'preset-123',
      action: 'refresh',
    });
    mockSessionManagerGet.mockResolvedValue(null);
    mockFetchPreset.mockResolvedValue(null);

    await handleButton(createMockButtonInteraction('preset::refresh::preset-123'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Preset not found.',
      embeds: [],
      components: [],
    });
  });

  it('should ignore non-preset interactions', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'character',
      entityId: 'char-123',
      action: 'close',
    });

    await handleButton(createMockButtonInteraction('character::close::char-123'));

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  describe('toggle-global button', () => {
    const mockFollowUp = vi.fn();

    function createToggleButtonInteraction(customId: string) {
      return {
        customId,
        user: { id: 'user-456' },
        channelId: 'channel-999',
        message: { id: 'message-789' },
        update: mockUpdate,
        deferUpdate: mockDeferUpdate,
        editReply: mockEditReply,
        followUp: mockFollowUp,
      } as unknown as Parameters<typeof handleButton>[0];
    }

    beforeEach(() => {
      mockFollowUp.mockClear();
    });

    it('should toggle preset from private to global', async () => {
      mockParseDashboardCustomId.mockReturnValue({
        entityType: 'preset',
        entityId: 'preset-123',
        action: 'toggle-global',
      });
      mockSessionManagerGet.mockResolvedValue({
        data: { id: 'preset-123', isGlobal: false, isOwned: true },
      });
      mockUpdatePreset.mockResolvedValue({ ...mockPresetData, isGlobal: true });

      await handleButton(createToggleButtonInteraction('preset::toggle-global::preset-123'));

      expect(mockDeferUpdate).toHaveBeenCalled();
      expect(mockUpdatePreset).toHaveBeenCalledWith('preset-123', { isGlobal: true }, 'user-456');
      expect(mockSessionManagerUpdate).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalled();
    });

    it('should toggle preset from global to private', async () => {
      mockParseDashboardCustomId.mockReturnValue({
        entityType: 'preset',
        entityId: 'preset-123',
        action: 'toggle-global',
      });
      mockSessionManagerGet.mockResolvedValue({
        data: { id: 'preset-123', isGlobal: true, isOwned: true },
      });
      mockUpdatePreset.mockResolvedValue({ ...mockPresetData, isGlobal: false });

      await handleButton(createToggleButtonInteraction('preset::toggle-global::preset-123'));

      expect(mockUpdatePreset).toHaveBeenCalledWith('preset-123', { isGlobal: false }, 'user-456');
    });

    it('should show error when session expired', async () => {
      mockParseDashboardCustomId.mockReturnValue({
        entityType: 'preset',
        entityId: 'preset-123',
        action: 'toggle-global',
      });
      mockSessionManagerGet.mockResolvedValue(null);

      await handleButton(createToggleButtonInteraction('preset::toggle-global::preset-123'));

      expect(mockDeferUpdate).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Session expired'),
        embeds: [],
        components: [],
      });
      expect(mockUpdatePreset).not.toHaveBeenCalled();
    });

    it('should show error when user does not own preset', async () => {
      mockParseDashboardCustomId.mockReturnValue({
        entityType: 'preset',
        entityId: 'preset-123',
        action: 'toggle-global',
      });
      mockSessionManagerGet.mockResolvedValue({
        data: { id: 'preset-123', isGlobal: false, isOwned: false },
      });

      await handleButton(createToggleButtonInteraction('preset::toggle-global::preset-123'));

      expect(mockFollowUp).toHaveBeenCalledWith({
        content: '❌ You can only toggle global status for presets you own.',
        flags: MessageFlags.Ephemeral,
      });
      expect(mockUpdatePreset).not.toHaveBeenCalled();
    });

    it('should show error on API failure', async () => {
      mockParseDashboardCustomId.mockReturnValue({
        entityType: 'preset',
        entityId: 'preset-123',
        action: 'toggle-global',
      });
      mockSessionManagerGet.mockResolvedValue({
        data: { id: 'preset-123', isGlobal: false, isOwned: true },
      });
      mockUpdatePreset.mockRejectedValue(new Error('API Error'));

      await handleButton(createToggleButtonInteraction('preset::toggle-global::preset-123'));

      expect(mockFollowUp).toHaveBeenCalledWith({
        content: '❌ Failed to update preset visibility. Please try again.',
        flags: MessageFlags.Ephemeral,
      });
    });
  });

  describe('clone button', () => {
    const mockFollowUp = vi.fn();

    function createCloneButtonInteraction(customId: string) {
      return {
        customId,
        user: { id: 'user-456' },
        channelId: 'channel-999',
        message: { id: 'message-789' },
        update: mockUpdate,
        deferUpdate: mockDeferUpdate,
        editReply: mockEditReply,
        followUp: mockFollowUp,
      } as unknown as Parameters<typeof handleButton>[0];
    }

    beforeEach(() => {
      mockFollowUp.mockClear();
      mockCreatePreset.mockClear();
    });

    it('should clone a preset with "(Copy)" suffix', async () => {
      mockParseDashboardCustomId.mockReturnValue({
        entityType: 'preset',
        entityId: 'preset-123',
        action: 'clone',
      });
      mockSessionManagerGet.mockResolvedValue({
        data: {
          id: 'preset-123',
          name: 'Test Preset',
          model: 'anthropic/claude-sonnet-4',
          provider: 'openrouter',
          description: 'A test preset',
          maxReferencedMessages: '10',
          temperature: '0.7',
          isGlobal: false,
          isOwned: true,
        },
      });
      const clonedPreset = { ...mockPresetData, id: 'preset-456', name: 'Test Preset (Copy)' };
      mockCreatePreset.mockResolvedValue(clonedPreset);
      mockUpdatePreset.mockResolvedValue(clonedPreset); // For copying advanced params
      mockFetchPreset.mockResolvedValue(clonedPreset);

      await handleButton(createCloneButtonInteraction('preset::clone::preset-123'));

      expect(mockDeferUpdate).toHaveBeenCalled();
      expect(mockCreatePreset).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Preset (Copy)',
          model: 'anthropic/claude-sonnet-4',
          provider: 'openrouter',
        }),
        'user-456',
        expect.anything()
      );
      expect(mockSessionManagerSet).toHaveBeenCalled();
      expect(mockSessionManagerDelete).toHaveBeenCalledWith('user-456', 'preset', 'preset-123');
      expect(mockEditReply).toHaveBeenCalled();
    });

    it('should increment copy number for already-copied presets', async () => {
      mockParseDashboardCustomId.mockReturnValue({
        entityType: 'preset',
        entityId: 'preset-123',
        action: 'clone',
      });
      // Note: no advanced params here, so updatePreset won't be called
      mockSessionManagerGet.mockResolvedValue({
        data: {
          id: 'preset-123',
          name: 'Test Preset (Copy)',
          model: 'anthropic/claude-sonnet-4',
          provider: 'openrouter',
          isGlobal: false,
          isOwned: true,
        },
      });
      const clonedPreset = { ...mockPresetData, id: 'preset-456', name: 'Test Preset (Copy 2)' };
      mockCreatePreset.mockResolvedValue(clonedPreset);
      mockFetchPreset.mockResolvedValue(clonedPreset);

      await handleButton(createCloneButtonInteraction('preset::clone::preset-123'));

      expect(mockCreatePreset).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Preset (Copy 2)',
        }),
        'user-456',
        expect.anything()
      );
    });

    it('should copy advanced parameters to cloned preset', async () => {
      mockParseDashboardCustomId.mockReturnValue({
        entityType: 'preset',
        entityId: 'preset-123',
        action: 'clone',
      });
      mockSessionManagerGet.mockResolvedValue({
        data: {
          id: 'preset-123',
          name: 'Test Preset',
          model: 'anthropic/claude-sonnet-4',
          provider: 'openrouter',
          temperature: '0.8',
          top_p: '0.9',
          isGlobal: false,
          isOwned: true,
        },
      });
      const clonedPreset = { ...mockPresetData, id: 'preset-456' };
      mockCreatePreset.mockResolvedValue(clonedPreset);
      mockUpdatePreset.mockResolvedValue(clonedPreset);
      mockFetchPreset.mockResolvedValue(clonedPreset);

      await handleButton(createCloneButtonInteraction('preset::clone::preset-123'));

      // Should call updatePreset to copy advanced params
      expect(mockUpdatePreset).toHaveBeenCalledWith(
        'preset-456',
        expect.objectContaining({
          advancedParameters: expect.objectContaining({
            temperature: 0.8,
            top_p: 0.9,
          }),
        }),
        'user-456'
      );
    });

    it('should show error when session expired', async () => {
      mockParseDashboardCustomId.mockReturnValue({
        entityType: 'preset',
        entityId: 'preset-123',
        action: 'clone',
      });
      mockSessionManagerGet.mockResolvedValue(null);

      await handleButton(createCloneButtonInteraction('preset::clone::preset-123'));

      expect(mockDeferUpdate).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Session expired'),
        embeds: [],
        components: [],
      });
      expect(mockCreatePreset).not.toHaveBeenCalled();
    });

    it('should show error on API failure', async () => {
      mockParseDashboardCustomId.mockReturnValue({
        entityType: 'preset',
        entityId: 'preset-123',
        action: 'clone',
      });
      mockSessionManagerGet.mockResolvedValue({
        data: {
          id: 'preset-123',
          name: 'Test Preset',
          model: 'anthropic/claude-sonnet-4',
          provider: 'openrouter',
          isGlobal: false,
          isOwned: true,
        },
      });
      mockCreatePreset.mockRejectedValue(new Error('API Error'));

      await handleButton(createCloneButtonInteraction('preset::clone::preset-123'));

      expect(mockFollowUp).toHaveBeenCalledWith({
        content: '❌ Failed to clone preset. Please try again.',
        flags: MessageFlags.Ephemeral,
      });
    });
  });
});
