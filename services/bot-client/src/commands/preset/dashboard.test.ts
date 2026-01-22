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
vi.mock('./api.js', () => ({
  fetchPreset: (...args: unknown[]) => mockFetchPreset(...args),
  updatePreset: (...args: unknown[]) => mockUpdatePreset(...args),
  fetchGlobalPreset: (...args: unknown[]) => mockFetchGlobalPreset(...args),
  updateGlobalPreset: (...args: unknown[]) => mockUpdateGlobalPreset(...args),
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
  it('should delegate to isDashboardInteraction', () => {
    mockIsDashboardInteraction.mockReturnValue(true);

    const result = isPresetDashboardInteraction('preset::modal::123::identity');

    expect(mockIsDashboardInteraction).toHaveBeenCalledWith(
      'preset::modal::123::identity',
      'preset'
    );
    expect(result).toBe(true);
  });

  it('should return false for non-preset interactions', () => {
    mockIsDashboardInteraction.mockReturnValue(false);

    const result = isPresetDashboardInteraction('character::modal::123::identity');

    expect(result).toBe(false);
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

  it('should handle close button', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'preset',
      entityId: 'preset-123',
      action: 'close',
    });

    await handleButton(createMockButtonInteraction('preset::close::preset-123'));

    expect(mockSessionManagerDelete).toHaveBeenCalledWith('user-456', 'preset', 'preset-123');
    expect(mockUpdate).toHaveBeenCalledWith({
      content: '✅ Dashboard closed.',
      embeds: [],
      components: [],
    });
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

  it('should fetch global preset when session indicates global', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'preset',
      entityId: 'preset-123',
      action: 'refresh',
    });
    mockSessionManagerGet.mockResolvedValue({
      data: { id: 'preset-123', isGlobal: true },
    });
    mockFetchGlobalPreset.mockResolvedValue(mockPresetData);

    await handleButton(createMockButtonInteraction('preset::refresh::preset-123'));

    expect(mockFetchGlobalPreset).toHaveBeenCalledWith('preset-123');
    expect(mockFetchPreset).not.toHaveBeenCalled();
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
});
