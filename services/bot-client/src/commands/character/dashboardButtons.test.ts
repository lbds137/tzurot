/**
 * Tests for Character Dashboard Button Handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction, Client } from 'discord.js';
import { handleBackButton, handleRefreshButton, handleCloseButton } from './dashboardButtons.js';
import { handleDashboardClose } from '../../utils/dashboard/closeHandler.js';

// Mock dependencies
const mockFetchCharacter = vi.fn();
vi.mock('./api.js', () => ({
  fetchCharacter: (...args: unknown[]) => mockFetchCharacter(...args),
}));

const mockBuildBrowseResponse = vi.fn();
vi.mock('./browse.js', () => ({
  buildBrowseResponse: (...args: unknown[]) => mockBuildBrowseResponse(...args),
}));

const mockSessionManager = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

// Mock getSessionOrExpired to delegate to mockSessionManager
const mockGetSessionOrExpired = vi
  .fn()
  .mockImplementation(async (interaction, entityType, entityId, _command) => {
    const session = await mockSessionManager.get(interaction.user.id, entityType, entityId);
    if (session === null) {
      await interaction.editReply({
        content: 'Session expired. Please run /character browse to try again.',
        embeds: [],
        components: [],
      });
    }
    return session;
  });

vi.mock('../../utils/dashboard/index.js', async () => {
  const actual = await vi.importActual('../../utils/dashboard/index.js');
  return {
    ...actual,
    getSessionManager: () => mockSessionManager,
    getSessionOrExpired: (...args: unknown[]) => mockGetSessionOrExpired(...args),
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
    isBotOwner: () => false,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('Character Dashboard Buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager.get.mockResolvedValue(null);
    mockSessionManager.set.mockResolvedValue(undefined);
    mockSessionManager.delete.mockResolvedValue(undefined);
    // Reset getSessionOrExpired to default implementation
    mockGetSessionOrExpired.mockImplementation(
      async (interaction, entityType, entityId, _command) => {
        const session = await mockSessionManager.get(interaction.user.id, entityType, entityId);
        if (session === null) {
          await interaction.editReply({
            content: 'Session expired. Please run /character browse to try again.',
            embeds: [],
            components: [],
          });
        }
        return session;
      }
    );
  });

  const createMockCharacterData = (overrides?: Record<string, unknown>) => ({
    id: 'char-123',
    name: 'Test Character',
    displayName: 'Test Character',
    slug: 'test-character',
    characterInfo: 'A test character',
    personalityTraits: 'Friendly',
    personalityTone: null,
    personalityAge: null,
    personalityAppearance: null,
    personalityLikes: null,
    personalityDislikes: null,
    conversationalGoals: null,
    conversationalExamples: null,
    errorMessage: null,
    birthMonth: null,
    birthDay: null,
    birthYear: null,
    isPublic: false,
    voiceEnabled: false,
    imageEnabled: false,
    ownerId: 'user-123',
    avatarData: null,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    canEdit: true,
    ...overrides,
  });

  const createMockButtonInteraction = (customId: string) =>
    ({
      customId,
      user: { id: 'user-123' },
      message: { id: 'msg-123' },
      channelId: 'channel-123',
      client: {} as Client,
      update: vi.fn(),
      deferUpdate: vi.fn(),
      editReply: vi.fn(),
      reply: vi.fn(),
      followUp: vi.fn(),
    }) as unknown as ButtonInteraction;

  describe('handleCloseButton', () => {
    it('should delegate to shared close handler', async () => {
      const mockInteraction = createMockButtonInteraction('character::close::test-character');

      await handleCloseButton(mockInteraction, 'test-character');

      // Verify the shared handler was called with correct arguments
      expect(handleDashboardClose).toHaveBeenCalledWith(
        mockInteraction,
        'character',
        'test-character'
      );
    });
  });

  describe('handleRefreshButton', () => {
    it('should refresh character data', async () => {
      const mockInteraction = createMockButtonInteraction('character::refresh::test-character');

      mockSessionManager.get.mockResolvedValue({
        data: createMockCharacterData(),
      });
      mockFetchCharacter.mockResolvedValue(createMockCharacterData());

      await handleRefreshButton(mockInteraction, 'test-character');

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
      expect(mockFetchCharacter).toHaveBeenCalled();
      expect(mockSessionManager.set).toHaveBeenCalled();
    });

    it('should show error if character not found', async () => {
      const mockInteraction = createMockButtonInteraction('character::refresh::test-character');

      mockSessionManager.get.mockResolvedValue({ data: createMockCharacterData() });
      mockFetchCharacter.mockResolvedValue(null);

      await handleRefreshButton(mockInteraction, 'test-character');

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Character not found'),
        embeds: [],
        components: [],
      });
    });

    it('should preserve browseContext when refreshing', async () => {
      const mockInteraction = createMockButtonInteraction('character::refresh::test-character');
      const browseContext = { source: 'browse' as const, page: 2, filter: 'owned', sort: 'name' };

      mockSessionManager.get.mockResolvedValue({
        data: createMockCharacterData({ browseContext }),
      });
      mockFetchCharacter.mockResolvedValue(createMockCharacterData());

      await handleRefreshButton(mockInteraction, 'test-character');

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
      const mockInteraction = createMockButtonInteraction('character::refresh::test-character');

      mockSessionManager.get.mockResolvedValue({
        data: createMockCharacterData({ browseContext: undefined }),
      });
      mockFetchCharacter.mockResolvedValue(createMockCharacterData());

      await handleRefreshButton(mockInteraction, 'test-character');

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

  describe('handleBackButton', () => {
    it('should return to browse list with saved context', async () => {
      const mockInteraction = createMockButtonInteraction('character::back::test-character');
      const browseContext = {
        source: 'browse' as const,
        page: 1,
        filter: 'owned',
        sort: 'date',
      };

      mockSessionManager.get.mockResolvedValue({
        data: createMockCharacterData({ browseContext }),
      });
      mockBuildBrowseResponse.mockResolvedValue({
        embed: { data: { title: 'Browse Characters' } },
        components: [],
      });

      await handleBackButton(mockInteraction, 'test-character');

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
      expect(mockBuildBrowseResponse).toHaveBeenCalledWith(
        'user-123',
        expect.anything(),
        expect.anything(),
        {
          page: 1,
          filter: 'owned',
          sort: 'date',
          query: null,
        }
      );
      expect(mockSessionManager.delete).toHaveBeenCalledWith(
        'user-123',
        'character',
        'test-character'
      );
    });

    it('should show expired message when no browseContext', async () => {
      const mockInteraction = createMockButtonInteraction('character::back::test-character');

      mockSessionManager.get.mockResolvedValue({
        data: createMockCharacterData({ browseContext: undefined }),
      });

      await handleBackButton(mockInteraction, 'test-character');

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Session expired'),
        embeds: [],
        components: [],
      });
    });

    it('should show expired message when session is null', async () => {
      const mockInteraction = createMockButtonInteraction('character::back::test-character');

      mockSessionManager.get.mockResolvedValue(null);

      await handleBackButton(mockInteraction, 'test-character');

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Session expired'),
        embeds: [],
        components: [],
      });
    });

    it('should show error when buildBrowseResponse throws', async () => {
      const mockInteraction = createMockButtonInteraction('character::back::test-character');
      const browseContext = { source: 'browse' as const, page: 1, filter: 'all', sort: 'date' };

      mockSessionManager.get.mockResolvedValue({
        data: createMockCharacterData({ browseContext }),
      });
      mockBuildBrowseResponse.mockRejectedValue(new Error('API error'));

      await handleBackButton(mockInteraction, 'test-character');

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to load browse list'),
        embeds: [],
        components: [],
      });
    });

    it('should include query from browseContext', async () => {
      const mockInteraction = createMockButtonInteraction('character::back::test-character');
      const browseContext = {
        source: 'browse' as const,
        page: 0,
        filter: 'all',
        sort: 'name',
        query: 'luna',
      };

      mockSessionManager.get.mockResolvedValue({
        data: createMockCharacterData({ browseContext }),
      });
      mockBuildBrowseResponse.mockResolvedValue({
        embed: { data: { title: 'Browse Characters' } },
        components: [],
      });

      await handleBackButton(mockInteraction, 'test-character');

      expect(mockBuildBrowseResponse).toHaveBeenCalledWith(
        'user-123',
        expect.anything(),
        expect.anything(),
        {
          page: 0,
          filter: 'all',
          sort: 'name',
          query: 'luna',
        }
      );
    });

    it('should default sort to date when not specified', async () => {
      const mockInteraction = createMockButtonInteraction('character::back::test-character');
      const browseContext = {
        source: 'browse' as const,
        page: 0,
        filter: 'all',
        // No sort specified
      };

      mockSessionManager.get.mockResolvedValue({
        data: createMockCharacterData({ browseContext }),
      });
      mockBuildBrowseResponse.mockResolvedValue({
        embed: { data: { title: 'Browse Characters' } },
        components: [],
      });

      await handleBackButton(mockInteraction, 'test-character');

      expect(mockBuildBrowseResponse).toHaveBeenCalledWith(
        'user-123',
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          sort: 'date', // Should default to 'date'
        })
      );
    });
  });
});
