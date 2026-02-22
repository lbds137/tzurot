/**
 * Tests for Preset Dashboard Button Handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import {
  buildPresetDashboardOptions,
  handleCloseButton,
  handleRefreshButton,
  handleDeleteButton,
  handleConfirmDeleteButton,
  handleCancelDeleteButton,
  handleCloneButton,
  handleBackButton,
  generateClonedName,
} from './dashboardButtons.js';
import { handleDashboardClose } from '../../utils/dashboard/closeHandler.js';
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

const mockBuildBrowseResponse = vi.fn();
vi.mock('./browse.js', () => ({
  buildBrowseResponse: (...args: unknown[]) => mockBuildBrowseResponse(...args),
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

// Session helper mocks - delegate to session manager and handle error responses
const mockGetSessionOrExpired = vi
  .fn()
  .mockImplementation(async (interaction, entityType, entityId) => {
    const session = await mockSessionManager.get(interaction.user.id, entityType, entityId);
    if (session === null) {
      // Mimic real behavior: call editReply with expired message
      await interaction.editReply({
        content: 'Session expired. Please run /preset browse to try again.',
        embeds: [],
        components: [],
      });
    }
    return session;
  });
const mockGetSessionDataOrReply = vi
  .fn()
  .mockImplementation(async (interaction, entityType, entityId) => {
    const session = await mockSessionManager.get(interaction.user.id, entityType, entityId);
    if (session === null) {
      // Mimic real behavior: call reply with expired message
      await interaction.reply({
        content: 'Session expired. Please try again.',
        flags: 64, // MessageFlags.Ephemeral
      });
      return null;
    }
    return session.data;
  });
// Mock requireDeferredSession: deferUpdate + getSessionOrExpired
const mockRequireDeferredSession = vi
  .fn()
  .mockImplementation(async (interaction, entityType, entityId, command) => {
    await interaction.deferUpdate();
    return mockGetSessionOrExpired(interaction, entityType, entityId, command);
  });
// checkOwnership mock - track calls so tests can override behavior
const mockCheckOwnership = vi
  .fn()
  .mockImplementation(async (_interaction, _entity, _action, _options) => {
    // Default: owner (tests can override with mockCheckOwnership.mockResolvedValue(false))
    // When tests set mockResolvedValue(false), this implementation is replaced
    return true;
  });

vi.mock('../../utils/dashboard/index.js', async () => {
  const actual = await vi.importActual('../../utils/dashboard/index.js');
  return {
    ...actual,
    getSessionManager: () => mockSessionManager,
    requireDeferredSession: (...args: unknown[]) => mockRequireDeferredSession(...args),
    getSessionOrExpired: (...args: unknown[]) => mockGetSessionOrExpired(...args),
    getSessionDataOrReply: (...args: unknown[]) => mockGetSessionDataOrReply(...args),
    checkOwnership: (...args: unknown[]) => mockCheckOwnership(...args),
  };
});

vi.mock('../../utils/dashboard/closeHandler.js', () => ({
  handleDashboardClose: vi.fn().mockResolvedValue(undefined),
}));

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

describe('generateClonedName', () => {
  it('should add (Copy) to simple name', () => {
    expect(generateClonedName('My Preset')).toBe('My Preset (Copy)');
  });

  it('should add (Copy) to name with special characters', () => {
    expect(generateClonedName('Test @ #1')).toBe('Test @ #1 (Copy)');
  });

  it('should increment (Copy) to (Copy 2)', () => {
    expect(generateClonedName('My Preset (Copy)')).toBe('My Preset (Copy 2)');
  });

  it('should increment (Copy 2) to (Copy 3)', () => {
    expect(generateClonedName('My Preset (Copy 2)')).toBe('My Preset (Copy 3)');
  });

  it('should increment large copy numbers', () => {
    expect(generateClonedName('My Preset (Copy 99)')).toBe('My Preset (Copy 100)');
  });

  it('should handle multiple (Copy) suffixes by finding max', () => {
    // Edge case: "Preset (Copy) (Copy)" - both are unnumbered (treated as 1)
    // max is 1, so result is max + 1 = 2
    expect(generateClonedName('Preset (Copy) (Copy)')).toBe('Preset (Copy 2)');
  });

  it('should handle mixed copy suffixes', () => {
    // "Preset (Copy 2) (Copy)" - max is 2, so next is 3
    expect(generateClonedName('Preset (Copy 2) (Copy)')).toBe('Preset (Copy 3)');
  });

  it('should handle numbered copy before unnumbered', () => {
    // "Preset (Copy 5) (Copy)" - max is 5, so next is 6
    expect(generateClonedName('Preset (Copy 5) (Copy)')).toBe('Preset (Copy 6)');
  });

  it('should handle copy suffix in middle - should NOT match', () => {
    // "(Copy)" in the middle of name should NOT be matched by the end regex
    expect(generateClonedName('Preset (Copy) Edition')).toBe('Preset (Copy) Edition (Copy)');
  });

  it('should handle case-insensitive matching', () => {
    expect(generateClonedName('My Preset (copy)')).toBe('My Preset (Copy 2)');
    expect(generateClonedName('My Preset (COPY)')).toBe('My Preset (Copy 2)');
    expect(generateClonedName('My Preset (CoPy 5)')).toBe('My Preset (Copy 6)');
  });

  it('should handle whitespace variations in suffix', () => {
    expect(generateClonedName('My Preset  (Copy) ')).toBe('My Preset (Copy 2)');
    expect(generateClonedName('My Preset (Copy 3) ')).toBe('My Preset (Copy 4)');
  });

  it('should preserve base name with trailing spaces trimmed', () => {
    expect(generateClonedName('  Spaced Name  (Copy)')).toBe('Spaced Name (Copy 2)');
  });
});

describe('Preset Dashboard Buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Session manager defaults
    mockSessionManager.get.mockResolvedValue(null);
    mockSessionManager.set.mockResolvedValue(undefined);
    mockSessionManager.delete.mockResolvedValue(undefined);
    // Reset ownership check to default (owner)
    mockCheckOwnership.mockResolvedValue(true);
  });

  const createMockFlattenedPreset = (
    overrides?: Partial<FlattenedPresetData>
  ): FlattenedPresetData =>
    ({
      id: 'preset-123',
      name: 'Test Preset',
      description: 'A test preset',
      provider: 'openrouter',
      model: 'gpt-4',
      visionModel: '',
      isGlobal: false,
      isOwned: true,
      canEdit: true,
      temperature: '0.7',
      max_tokens: '4000',
      top_p: '',
      top_k: '',
      seed: '',
      frequency_penalty: '',
      presence_penalty: '',
      repetition_penalty: '',
      min_p: '',
      top_a: '',
      reasoning_effort: '',
      reasoning_max_tokens: '',
      reasoning_exclude: '',
      reasoning_enabled: '',
      show_thinking: '',
      contextWindowTokens: '131072',
      ...overrides,
    }) as FlattenedPresetData;

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

    it('should show close button when no browseContext', () => {
      const data = createMockFlattenedPreset({ browseContext: undefined });
      const options = buildPresetDashboardOptions(data);

      expect(options.showClose).toBe(true);
      expect(options.showBack).toBe(false);
    });

    it('should show back button when browseContext exists', () => {
      const data = createMockFlattenedPreset({
        browseContext: { source: 'browse', page: 1, filter: 'all' },
      });
      const options = buildPresetDashboardOptions(data);

      expect(options.showBack).toBe(true);
      expect(options.showClose).toBe(false);
    });
  });

  describe('handleCloseButton', () => {
    it('should delegate to shared close handler', async () => {
      const mockInteraction = createMockButtonInteraction('preset::close::preset-123');

      await handleCloseButton(mockInteraction, 'preset-123');

      // Verify the shared handler was called with correct arguments
      expect(handleDashboardClose).toHaveBeenCalledWith(mockInteraction, 'preset', 'preset-123');
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
    contextWindowTokens: 8192,
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

    it('should refresh with global preset data via user endpoint first', async () => {
      const mockInteraction = createMockButtonInteraction('preset::refresh::preset-123');

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({ isGlobal: true }),
      });
      // User endpoint returns global preset (it's accessible)
      mockFetchPreset.mockResolvedValue(
        createMockPresetResponse({
          isGlobal: true,
          isOwned: false,
          permissions: { canEdit: false },
        })
      );

      await handleRefreshButton(mockInteraction, 'preset-123');

      // Should try user endpoint first (works for accessible global presets)
      expect(mockFetchPreset).toHaveBeenCalledWith('preset-123', 'user-123');
      // Should not need to fall back to global endpoint
      expect(mockFetchGlobalPreset).not.toHaveBeenCalled();
    });

    it('should fall back to global endpoint when user endpoint returns null', async () => {
      const mockInteraction = createMockButtonInteraction('preset::refresh::preset-123');

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({ isGlobal: true }),
      });
      // User endpoint returns null (not accessible via user endpoint)
      mockFetchPreset.mockResolvedValue(null);
      // Global endpoint returns the preset
      mockFetchGlobalPreset.mockResolvedValue(
        createMockPresetResponse({
          isGlobal: true,
          isOwned: false,
          permissions: { canEdit: false },
        })
      );

      await handleRefreshButton(mockInteraction, 'preset-123');

      // Should try user endpoint first
      expect(mockFetchPreset).toHaveBeenCalledWith('preset-123', 'user-123');
      // Should fall back to global endpoint
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

    it('should preserve browseContext when refreshing', async () => {
      const mockInteraction = createMockButtonInteraction('preset::refresh::preset-123');
      const browseContext = { source: 'browse' as const, page: 2, filter: 'owned' };

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({ isGlobal: false, browseContext }),
      });
      mockFetchPreset.mockResolvedValue(createMockPresetResponse({ isGlobal: false }));

      await handleRefreshButton(mockInteraction, 'preset-123');

      // Verify session was set with preserved browseContext
      expect(mockSessionManager.set).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            browseContext,
          }),
        })
      );
    });

    it('should not include browseContext when original session had none', async () => {
      const mockInteraction = createMockButtonInteraction('preset::refresh::preset-123');

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({ isGlobal: false, browseContext: undefined }),
      });
      mockFetchPreset.mockResolvedValue(createMockPresetResponse({ isGlobal: false }));

      await handleRefreshButton(mockInteraction, 'preset-123');

      // Verify session was set without browseContext
      expect(mockSessionManager.set).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            browseContext: undefined,
          }),
        })
      );
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
      // Mock ownership check to return false (checkOwnership handles the error reply)
      mockCheckOwnership.mockResolvedValue(false);

      await handleDeleteButton(mockInteraction, 'preset-123');

      // checkOwnership handles the error reply - just verify update wasn't called
      expect(mockInteraction.update).not.toHaveBeenCalled();
    });

    it('should show error if session expired', async () => {
      const mockInteraction = createMockButtonInteraction('preset::delete::preset-123');

      mockSessionManager.get.mockResolvedValue(null);

      await handleDeleteButton(mockInteraction, 'preset-123');

      // getSessionDataOrReply handles the error reply
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
      expect(mockCreatePreset).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Original Preset (Copy)' }),
        expect.anything(),
        expect.anything()
      );
    });

    it('should increment copy number when cloning a copy', async () => {
      const mockInteraction = createMockButtonInteraction('preset::clone::preset-123');

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({ name: 'My Preset (Copy)' }),
      });
      mockCreatePreset.mockResolvedValue({
        id: 'cloned-preset',
        name: 'My Preset (Copy 2)',
        slug: 'my-preset-copy-2',
      });

      await handleCloneButton(mockInteraction, 'preset-123');

      expect(mockCreatePreset).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My Preset (Copy 2)' }),
        expect.anything(),
        expect.anything()
      );
    });

    it('should increment existing copy number', async () => {
      const mockInteraction = createMockButtonInteraction('preset::clone::preset-123');

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({ name: 'My Preset (Copy 5)' }),
      });
      mockCreatePreset.mockResolvedValue({
        id: 'cloned-preset',
        name: 'My Preset (Copy 6)',
        slug: 'my-preset-copy-6',
      });

      await handleCloneButton(mockInteraction, 'preset-123');

      expect(mockCreatePreset).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My Preset (Copy 6)' }),
        expect.anything(),
        expect.anything()
      );
    });

    it('should append (Copy) when name contains (Copy) not at end', async () => {
      const mockInteraction = createMockButtonInteraction('preset::clone::preset-123');

      // Edge case: "(Copy)" in the middle of name should NOT be matched
      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({ name: 'Preset (Copy) Edition' }),
      });
      mockCreatePreset.mockResolvedValue({
        id: 'cloned-preset',
        name: 'Preset (Copy) Edition (Copy)',
        slug: 'preset-copy-edition-copy',
      });

      await handleCloneButton(mockInteraction, 'preset-123');

      // Should append (Copy) since (Copy) is not at the end
      expect(mockCreatePreset).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Preset (Copy) Edition (Copy)' }),
        expect.anything(),
        expect.anything()
      );
    });

    it('should copy context, memory, and advanced settings when cloning', async () => {
      const mockInteraction = createMockButtonInteraction('preset::clone::preset-123');

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({
          name: 'Full Preset',
          temperature: '0.8',
          contextWindowTokens: '262144',
        }),
      });
      const clonedPreset = {
        id: 'cloned-preset',
        name: 'Full Preset (Copy)',
        slug: 'full-preset-copy',
      };
      mockCreatePreset.mockResolvedValue(clonedPreset);
      mockFetchPreset.mockResolvedValue(createMockPresetResponse({ id: 'cloned-preset' }));

      await handleCloneButton(mockInteraction, 'preset-123');

      // Verify update was called with context window and advanced settings
      expect(mockUpdatePreset).toHaveBeenCalledWith(
        'cloned-preset',
        expect.objectContaining({
          contextWindowTokens: 262144,
          advancedParameters: expect.objectContaining({
            temperature: 0.8,
          }),
        }),
        'user-123'
      );
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

  describe('handleBackButton', () => {
    it('should return to browse list with saved context', async () => {
      const mockInteraction = createMockButtonInteraction('preset::back::preset-123');
      const browseContext = { source: 'browse' as const, page: 1, filter: 'owned' };

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({ browseContext }),
      });
      mockBuildBrowseResponse.mockResolvedValue({
        embed: { data: { title: 'Browse Presets' } },
        components: [],
      });

      await handleBackButton(mockInteraction, 'preset-123');

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
      expect(mockBuildBrowseResponse).toHaveBeenCalledWith('user-123', {
        page: 1,
        filter: 'owned',
        query: null,
      });
      expect(mockSessionManager.delete).toHaveBeenCalledWith('user-123', 'preset', 'preset-123');
    });

    it('should show expired message when no browseContext', async () => {
      const mockInteraction = createMockButtonInteraction('preset::back::preset-123');

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({ browseContext: undefined }),
      });

      await handleBackButton(mockInteraction, 'preset-123');

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Session expired'),
        embeds: [],
        components: [],
      });
    });

    it('should show expired message when session is null', async () => {
      const mockInteraction = createMockButtonInteraction('preset::back::preset-123');

      mockSessionManager.get.mockResolvedValue(null);

      await handleBackButton(mockInteraction, 'preset-123');

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Session expired'),
        embeds: [],
        components: [],
      });
    });

    it('should show error when buildBrowseResponse fails', async () => {
      const mockInteraction = createMockButtonInteraction('preset::back::preset-123');
      const browseContext = { source: 'browse' as const, page: 1, filter: 'all' };

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({ browseContext }),
      });
      mockBuildBrowseResponse.mockResolvedValue(null);

      await handleBackButton(mockInteraction, 'preset-123');

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to load browse list'),
        embeds: [],
        components: [],
      });
    });

    it('should include query from browseContext', async () => {
      const mockInteraction = createMockButtonInteraction('preset::back::preset-123');
      const browseContext = {
        source: 'browse' as const,
        page: 0,
        filter: 'all',
        query: 'gpt',
      };

      mockSessionManager.get.mockResolvedValue({
        data: createMockFlattenedPreset({ browseContext }),
      });
      mockBuildBrowseResponse.mockResolvedValue({
        embed: { data: { title: 'Browse Presets' } },
        components: [],
      });

      await handleBackButton(mockInteraction, 'preset-123');

      expect(mockBuildBrowseResponse).toHaveBeenCalledWith('user-123', {
        page: 0,
        filter: 'all',
        query: 'gpt',
      });
    });
  });
});
