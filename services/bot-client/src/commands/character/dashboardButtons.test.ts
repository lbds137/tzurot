/**
 * Tests for Character Dashboard Button Handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction, Client } from 'discord.js';
import { handleRefreshButton, handleCloseButton } from './dashboardButtons.js';
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

// renderTerminalScreen imports getSessionManager directly from
// SessionManager.js (not via the index barrel), so the index.js mock above
// doesn't intercept it. Mock SessionManager at the source so renderTerminalScreen
// can run against the same mocked session manager during these tests.
vi.mock('../../utils/dashboard/SessionManager.js', () => ({
  getSessionManager: () => mockSessionManager,
  initSessionManager: vi.fn(),
  shutdownSessionManager: vi.fn(),
}));

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
    hasVoiceReference: false,
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

  // handleBackButton was deleted from this module in favor of the shared
  // handleSharedBackButton (utils/dashboard/sharedBackButtonHandler.ts),
  // which `dashboard.ts` routes `::back::` customIds to. Its behavioral
  // coverage lives in sharedBackButtonHandler.test.ts, parameterized across
  // every BrowseCapableEntityType.
});
