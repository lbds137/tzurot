/**
 * Tests for Preset Edit Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { handleEdit } from './edit.js';
import type { PresetData } from './config.js';

// Mock isBotOwner for testing bot owner behavior
const mockIsBotOwner = vi.fn().mockReturnValue(false);

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
    isBotOwner: (userId: string) => mockIsBotOwner(userId),
  };
});

// Mock api.ts
const mockFetchPreset = vi.fn();
vi.mock('./api.js', () => ({
  fetchPreset: (...args: unknown[]) => mockFetchPreset(...args),
}));

// Mock dashboard utilities
const mockBuildDashboardEmbed = vi.fn().mockReturnValue({ title: 'Test Embed' });
const mockBuildDashboardComponents = vi.fn().mockReturnValue([]);
const mockSessionManagerSet = vi.fn();
const mockGetSessionManager = vi.fn().mockReturnValue({
  set: mockSessionManagerSet,
});
vi.mock('../../utils/dashboard/index.js', () => ({
  buildDashboardEmbed: (...args: unknown[]) => mockBuildDashboardEmbed(...args),
  buildDashboardComponents: (...args: unknown[]) => mockBuildDashboardComponents(...args),
  getSessionManager: () => mockGetSessionManager(),
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
  maxReferencedMessages: 10,
  params: {
    temperature: 0.7,
  },
};

describe('handleEdit', () => {
  const mockDeferReply = vi.fn();
  const mockEditReply = vi.fn().mockResolvedValue({ id: 'message-789' });

  function createMockInteraction(presetId = 'preset-123') {
    return {
      user: { id: 'user-456' },
      channelId: 'channel-999',
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'preset') {
            return presetId;
          }
          return null;
        },
      },
      deferReply: mockDeferReply,
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleEdit>[0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should open dashboard for owned preset', async () => {
    mockFetchPreset.mockResolvedValue(mockPresetData);

    await handleEdit(createMockInteraction());

    expect(mockDeferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(mockFetchPreset).toHaveBeenCalledWith('preset-123', 'user-456');
    expect(mockBuildDashboardEmbed).toHaveBeenCalled();
    expect(mockBuildDashboardComponents).toHaveBeenCalledWith(
      expect.anything(),
      'preset-123',
      expect.objectContaining({ id: 'preset-123', name: 'Test Preset' }),
      { showClose: true, showRefresh: true }
    );
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [{ title: 'Test Embed' }],
      components: [],
    });
    expect(mockSessionManagerSet).toHaveBeenCalledWith({
      userId: 'user-456',
      entityType: 'preset',
      entityId: 'preset-123',
      data: expect.objectContaining({ id: 'preset-123' }),
      messageId: 'message-789',
      channelId: 'channel-999',
    });
  });

  it('should show error when preset not found', async () => {
    mockFetchPreset.mockResolvedValue(null);

    await handleEdit(createMockInteraction());

    expect(mockEditReply).toHaveBeenCalledWith('❌ Preset not found.');
    expect(mockBuildDashboardEmbed).not.toHaveBeenCalled();
    expect(mockSessionManagerSet).not.toHaveBeenCalled();
  });

  it('should show error when preset is not owned (non-global)', async () => {
    mockFetchPreset.mockResolvedValue({
      ...mockPresetData,
      isOwned: false,
      isGlobal: false,
    });

    await handleEdit(createMockInteraction());

    expect(mockEditReply).toHaveBeenCalledWith(
      '❌ You can only edit your own presets.\n' +
        'Use `/preset create` to create a copy of this preset.'
    );
    expect(mockBuildDashboardEmbed).not.toHaveBeenCalled();
    expect(mockSessionManagerSet).not.toHaveBeenCalled();
  });

  it('should show specific error for global preset when not bot owner', async () => {
    mockFetchPreset.mockResolvedValue({
      ...mockPresetData,
      isOwned: false,
      isGlobal: true,
    });
    mockIsBotOwner.mockReturnValue(false);

    await handleEdit(createMockInteraction());

    expect(mockEditReply).toHaveBeenCalledWith(
      '❌ Global presets can only be edited by the bot owner.\n' +
        'Use `/preset create` to create your own copy based on this preset.'
    );
    expect(mockBuildDashboardEmbed).not.toHaveBeenCalled();
    expect(mockSessionManagerSet).not.toHaveBeenCalled();
  });

  it('should allow bot owner to edit global preset', async () => {
    mockFetchPreset.mockResolvedValue({
      ...mockPresetData,
      isOwned: false,
      isGlobal: true,
    });
    mockIsBotOwner.mockReturnValue(true);

    await handleEdit(createMockInteraction());

    expect(mockBuildDashboardEmbed).toHaveBeenCalled();
    expect(mockBuildDashboardComponents).toHaveBeenCalled();
    expect(mockSessionManagerSet).toHaveBeenCalled();
  });

  it('should allow bot owner to edit non-owned non-global preset', async () => {
    mockFetchPreset.mockResolvedValue({
      ...mockPresetData,
      isOwned: false,
      isGlobal: false,
    });
    mockIsBotOwner.mockReturnValue(true);

    await handleEdit(createMockInteraction());

    expect(mockBuildDashboardEmbed).toHaveBeenCalled();
    expect(mockBuildDashboardComponents).toHaveBeenCalled();
    expect(mockSessionManagerSet).toHaveBeenCalled();
  });

  it('should handle fetch errors gracefully', async () => {
    mockFetchPreset.mockRejectedValue(new Error('Network error'));

    await handleEdit(createMockInteraction());

    expect(mockEditReply).toHaveBeenCalledWith('❌ Failed to load preset. Please try again.');
    expect(mockBuildDashboardEmbed).not.toHaveBeenCalled();
    expect(mockSessionManagerSet).not.toHaveBeenCalled();
  });
});
