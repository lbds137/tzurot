/**
 * Tests for Preset Browse Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import {
  handleBrowse,
  handleBrowsePagination,
  handleBrowseSelect,
  isPresetBrowseInteraction,
  isPresetBrowseSelectInteraction,
} from './browse.js';
import type { StringSelectMenuInteraction } from 'discord.js';
import { mockListLlmConfigsResponse, mockListWalletKeysResponse } from '@tzurot/common-types';

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

// Mock userGatewayClient
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  GATEWAY_TIMEOUTS: {
    AUTOCOMPLETE: 2500,
    DEFERRED: 10000,
  },
}));

// Mock dashboard utilities
const mockBuildDashboardEmbed = vi.fn(() => ({ toJSON: () => ({ title: 'Dashboard' }) }));
const mockBuildDashboardComponents = vi.fn(() => []);
const mockSessionManagerSet = vi.fn();
vi.mock('../../utils/dashboard/index.js', () => ({
  buildDashboardEmbed: (...args: unknown[]) =>
    mockBuildDashboardEmbed(...(args as Parameters<typeof mockBuildDashboardEmbed>)),
  buildDashboardComponents: (...args: unknown[]) =>
    mockBuildDashboardComponents(...(args as Parameters<typeof mockBuildDashboardComponents>)),
  getSessionManager: () => ({
    set: mockSessionManagerSet,
  }),
}));

// Mock preset api
const mockFetchPreset = vi.fn();
vi.mock('./api.js', () => ({
  fetchPreset: (...args: unknown[]) => mockFetchPreset(...args),
}));

// Mock preset config
vi.mock('./config.js', () => ({
  PRESET_DASHBOARD_CONFIG: { sections: [] },
  flattenPresetData: (data: Record<string, unknown>) => ({ ...data, isOwned: data.isOwned }),
  buildPresetDashboardOptions: vi.fn().mockReturnValue({
    showBack: false,
    showClose: true,
    showRefresh: true,
    showClone: true,
    showDelete: false,
  }),
}));

describe('handleBrowse', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(query: string | null = null, filter: string | null = null) {
    return {
      user: { id: '123456789' },
      interaction: {
        options: {
          getString: vi.fn((name: string) => {
            if (name === 'query') return query;
            if (name === 'filter') return filter;
            return null;
          }),
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleBrowse>[0];
  }

  function mockPresetApis(
    presets: Parameters<typeof mockListLlmConfigsResponse>[0],
    hasWallet = true
  ) {
    mockCallGatewayApi.mockImplementation((path: string) => {
      if (path === '/user/llm-config') {
        return Promise.resolve({
          ok: true,
          data: mockListLlmConfigsResponse(presets),
        });
      }
      if (path === '/wallet/list') {
        return Promise.resolve({
          ok: true,
          data: mockListWalletKeysResponse(hasWallet ? [{ isActive: true }] : []),
        });
      }
      return Promise.resolve({ ok: false, error: 'Unknown path' });
    });
  }

  it('should browse presets with default settings (no filter, no query)', async () => {
    mockPresetApis([
      {
        id: '1',
        name: 'Default',
        model: 'anthropic/claude-sonnet-4',
        isGlobal: true,
        isDefault: true,
        isOwned: false,
      },
      {
        id: '2',
        name: 'MyPreset',
        model: 'anthropic/claude-opus-4',
        isGlobal: false,
        isDefault: false,
        isOwned: true,
      },
    ]);

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/llm-config', {
      userId: '123456789',
      timeout: 10000,
    });
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '🔧 Preset Browser',
          }),
        }),
      ],
      components: expect.any(Array), // Select menu for choosing preset
    });

    // Verify components include select menu (no pagination buttons for small lists)
    const components = mockEditReply.mock.calls[0][0].components;
    expect(components).toHaveLength(1); // Just select menu, no pagination
    // Custom ID now includes browse context: preset::browse-select::page::filter::query
    expect(components[0].components[0].data.custom_id).toBe('preset::browse-select::0::all::');
  });

  it('should filter by global presets', async () => {
    mockPresetApis([
      {
        id: '1',
        name: 'Default',
        model: 'anthropic/claude-sonnet-4',
        isGlobal: true,
        isOwned: false,
      },
      {
        id: '2',
        name: 'MyPreset',
        model: 'anthropic/claude-opus-4',
        isGlobal: false,
        isOwned: true,
      },
    ]);

    const context = createMockContext(null, 'global');
    await handleBrowse(context);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    // Should only show global presets
    expect(embedData.description).toContain('Default');
    expect(embedData.description).not.toContain('MyPreset');
  });

  it('should filter by owned presets', async () => {
    mockPresetApis([
      {
        id: '1',
        name: 'Default',
        model: 'anthropic/claude-sonnet-4',
        isGlobal: true,
        isOwned: false,
      },
      {
        id: '2',
        name: 'MyPreset',
        model: 'anthropic/claude-opus-4',
        isGlobal: false,
        isOwned: true,
      },
    ]);

    const context = createMockContext(null, 'mine');
    await handleBrowse(context);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    // Should only show owned presets
    expect(embedData.description).not.toContain('Default');
    expect(embedData.description).toContain('MyPreset');
  });

  it('should filter by free presets', async () => {
    mockPresetApis([
      {
        id: '1',
        name: 'Paid Model',
        model: 'anthropic/claude-sonnet-4',
        isGlobal: true,
        isOwned: false,
      },
      {
        id: '2',
        name: 'Free Model',
        model: 'x-ai/grok-4.1-fast:free',
        isGlobal: true,
        isOwned: false,
      },
    ]);

    const context = createMockContext(null, 'free');
    await handleBrowse(context);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    // Should only show free presets
    expect(embedData.description).not.toContain('Paid Model');
    expect(embedData.description).toContain('Free Model');
  });

  it('should search by query', async () => {
    mockPresetApis([
      {
        id: '1',
        name: 'Claude Default',
        model: 'anthropic/claude-sonnet-4',
        isGlobal: true,
        isOwned: false,
      },
      {
        id: '2',
        name: 'GPT Config',
        model: 'openai/gpt-4o',
        isGlobal: true,
        isOwned: false,
      },
    ]);

    const context = createMockContext('claude', null);
    await handleBrowse(context);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    // Should only show matching presets
    expect(embedData.description).toContain('Claude Default');
    expect(embedData.description).not.toContain('GPT Config');
    expect(embedData.description).toContain('Searching: "claude"');
  });

  it('should show guest mode warning when no active wallet', async () => {
    mockPresetApis(
      [
        {
          id: '1',
          name: 'Default',
          model: 'anthropic/claude-sonnet-4',
          isGlobal: true,
          isOwned: false,
        },
      ],
      false // No wallet
    );

    const context = createMockContext();
    await handleBrowse(context);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    expect(embedData.description).toContain('Guest Mode');
  });

  it('should show no results message when filter produces empty results', async () => {
    mockPresetApis([
      {
        id: '1',
        name: 'Global Only',
        model: 'anthropic/claude-sonnet-4',
        isGlobal: true,
        isOwned: false,
      },
    ]);

    const context = createMockContext(null, 'mine');
    await handleBrowse(context);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    expect(embedData.description).toContain('No presets match your search');
  });

  it('should handle API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Server error',
    });

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to get presets. Please try again later.',
    });
  });

  it('should handle exceptions', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An error occurred. Please try again later.',
    });
  });
});

describe('handleBrowsePagination', () => {
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockButtonInteraction(customId: string) {
    return {
      customId,
      user: { id: '123456789' },
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
    } as unknown as ButtonInteraction;
  }

  function mockPresetApis(
    presets: Parameters<typeof mockListLlmConfigsResponse>[0],
    hasWallet = true
  ) {
    mockCallGatewayApi.mockImplementation((path: string) => {
      if (path === '/user/llm-config') {
        return Promise.resolve({
          ok: true,
          data: mockListLlmConfigsResponse(presets),
        });
      }
      if (path === '/wallet/list') {
        return Promise.resolve({
          ok: true,
          data: mockListWalletKeysResponse(hasWallet ? [{ isActive: true }] : []),
        });
      }
      return Promise.resolve({ ok: false, error: 'Unknown path' });
    });
  }

  it('should return early for invalid custom ID', async () => {
    const mockInteraction = createMockButtonInteraction('invalid::custom::id');
    await handleBrowsePagination(mockInteraction);

    expect(mockDeferUpdate).not.toHaveBeenCalled();
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should defer update on pagination', async () => {
    mockPresetApis([
      { id: '1', name: 'Default', model: 'anthropic/claude-sonnet-4', isGlobal: true },
    ]);

    const mockInteraction = createMockButtonInteraction('preset::browse::1::all::');
    await handleBrowsePagination(mockInteraction);

    expect(mockDeferUpdate).toHaveBeenCalled();
  });

  it('should refresh data and update reply', async () => {
    mockPresetApis([
      { id: '1', name: 'Default', model: 'anthropic/claude-sonnet-4', isGlobal: true },
    ]);

    const mockInteraction = createMockButtonInteraction('preset::browse::0::all::');
    await handleBrowsePagination(mockInteraction);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/llm-config', {
      userId: '123456789',
      timeout: 10000,
    });
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('should apply filter from custom ID', async () => {
    mockPresetApis([
      {
        id: '1',
        name: 'Global',
        model: 'anthropic/claude-sonnet-4',
        isGlobal: true,
        isOwned: false,
      },
      { id: '2', name: 'Mine', model: 'anthropic/claude-opus-4', isGlobal: false, isOwned: true },
    ]);

    const mockInteraction = createMockButtonInteraction('preset::browse::0::mine::');
    await handleBrowsePagination(mockInteraction);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    expect(embedData.description).toContain('Mine');
    expect(embedData.description).not.toContain('Global');
  });

  it('should apply query from custom ID', async () => {
    mockPresetApis([
      { id: '1', name: 'Claude Config', model: 'anthropic/claude-sonnet-4', isGlobal: true },
      { id: '2', name: 'GPT Config', model: 'openai/gpt-4o', isGlobal: true },
    ]);

    const mockInteraction = createMockButtonInteraction('preset::browse::0::all::claude');
    await handleBrowsePagination(mockInteraction);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    expect(embedData.description).toContain('Claude Config');
    expect(embedData.description).not.toContain('GPT Config');
  });

  it('should handle API error silently (keep existing content)', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Server error',
    });

    const mockInteraction = createMockButtonInteraction('preset::browse::1::all::');
    await handleBrowsePagination(mockInteraction);

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockEditReply).not.toHaveBeenCalled();
  });

  it('should handle exceptions gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    const mockInteraction = createMockButtonInteraction('preset::browse::1::all::');

    // Should not throw
    await expect(handleBrowsePagination(mockInteraction)).resolves.not.toThrow();
    expect(mockEditReply).not.toHaveBeenCalled();
  });
});

describe('isPresetBrowseInteraction', () => {
  it('should return true for browse custom IDs', () => {
    expect(isPresetBrowseInteraction('preset::browse::0::all::')).toBe(true);
  });

  it('should return false for non-browse custom IDs', () => {
    expect(isPresetBrowseInteraction('preset::menu::123')).toBe(false);
  });
});

describe('isPresetBrowseSelectInteraction', () => {
  it('should return true for browse-select custom ID', () => {
    expect(isPresetBrowseSelectInteraction('preset::browse-select')).toBe(true);
  });

  it('should return false for browse pagination custom IDs', () => {
    expect(isPresetBrowseSelectInteraction('preset::browse::0::all::')).toBe(false);
  });

  it('should return false for other custom IDs', () => {
    expect(isPresetBrowseSelectInteraction('preset::menu::123')).toBe(false);
  });
});

describe('handleBrowseSelect', () => {
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockSelectInteraction(presetId: string) {
    return {
      customId: 'preset::browse-select',
      values: [presetId],
      user: { id: '123456789' },
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
      message: { id: 'message-123' },
      channelId: 'channel-123',
    } as unknown as StringSelectMenuInteraction;
  }

  it('should open dashboard for selected preset', async () => {
    mockFetchPreset.mockResolvedValue({
      id: 'preset-123',
      name: 'Test Preset',
      model: 'anthropic/claude-sonnet-4',
      isOwned: true,
      isGlobal: false,
    });

    const mockInteraction = createMockSelectInteraction('preset-123');
    await handleBrowseSelect(mockInteraction);

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockFetchPreset).toHaveBeenCalledWith('preset-123', '123456789');
    expect(mockBuildDashboardEmbed).toHaveBeenCalled();
    expect(mockBuildDashboardComponents).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalled();
    expect(mockSessionManagerSet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '123456789',
        entityType: 'preset',
        entityId: 'preset-123',
      })
    );
  });

  it('should handle preset not found', async () => {
    mockFetchPreset.mockResolvedValue(null);

    const mockInteraction = createMockSelectInteraction('nonexistent');
    await handleBrowseSelect(mockInteraction);

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Preset not found.',
      embeds: [],
      components: [],
    });
  });

  it('should handle fetch errors', async () => {
    mockFetchPreset.mockRejectedValue(new Error('Network error'));

    const mockInteraction = createMockSelectInteraction('preset-123');
    await handleBrowseSelect(mockInteraction);

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to load preset. Please try again.',
      embeds: [],
      components: [],
    });
  });
});
