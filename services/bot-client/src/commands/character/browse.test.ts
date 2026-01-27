/**
 * Tests for Character Browse Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleBrowse,
  handleBrowsePagination,
  handleBrowseSelect,
  isCharacterBrowseInteraction,
  isCharacterBrowseSelectInteraction,
} from './browse.js';
import * as api from './api.js';
import type { EnvConfig } from '@tzurot/common-types';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';

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

// Mock api module
vi.mock('./api.js', () => ({
  fetchUserCharacters: vi.fn(),
  fetchPublicCharacters: vi.fn(),
  fetchUsernames: vi.fn(),
  fetchCharacter: vi.fn(),
}));

// Mock dashboard utilities
const mockSessionSet = vi.fn();
vi.mock('../../utils/dashboard/index.js', () => ({
  buildDashboardEmbed: vi.fn().mockReturnValue({
    data: { title: 'Mock Dashboard' },
  }),
  buildDashboardComponents: vi.fn().mockReturnValue([]),
  getSessionManager: () => ({
    set: mockSessionSet,
    get: vi.fn(),
    delete: vi.fn(),
  }),
}));

// Mock config module
vi.mock('./config.js', () => ({
  getCharacterDashboardConfig: vi.fn().mockReturnValue({
    entityType: 'character',
    sections: [],
  }),
}));

describe('handleBrowse', () => {
  const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchUserCharacters).mockResolvedValue([]);
    vi.mocked(api.fetchPublicCharacters).mockResolvedValue([]);
    vi.mocked(api.fetchUsernames).mockResolvedValue(new Map());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockContext(query: string | null = null, filter: string | null = null) {
    return {
      user: { id: '123456789' },
      interaction: {
        client: {
          users: {
            fetch: vi.fn(),
          },
        },
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

  it('should browse characters with default settings (no filter, no query)', async () => {
    vi.mocked(api.fetchUserCharacters).mockResolvedValue([
      {
        id: 'char-1',
        name: 'My Character',
        slug: 'my-char',
        displayName: null,
        isPublic: false,
        ownerId: '123456789',
        characterInfo: '',
        personalityTraits: '',
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
        voiceEnabled: false,
        imageEnabled: false,
        avatarData: null,
        createdAt: '',
        updatedAt: '',
      },
    ]);

    const context = createMockContext();
    await handleBrowse(context, mockConfig);

    expect(api.fetchUserCharacters).toHaveBeenCalledWith('123456789', mockConfig);
    expect(api.fetchPublicCharacters).toHaveBeenCalledWith('123456789', mockConfig);
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '📚 Character Browser',
          }),
        }),
      ],
      components: expect.any(Array),
    });
  });

  it('should filter by mine (owned only)', async () => {
    vi.mocked(api.fetchUserCharacters).mockResolvedValue([
      {
        id: 'char-1',
        name: 'My Character',
        slug: 'my-char',
        displayName: null,
        isPublic: false,
        ownerId: '123456789',
        characterInfo: '',
        personalityTraits: '',
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
        voiceEnabled: false,
        imageEnabled: false,
        avatarData: null,
        createdAt: '',
        updatedAt: '',
      },
    ]);
    vi.mocked(api.fetchPublicCharacters).mockResolvedValue([
      {
        id: 'char-2',
        name: 'Other Character',
        slug: 'other-char',
        displayName: null,
        isPublic: true,
        ownerId: 'other-user',
        characterInfo: '',
        personalityTraits: '',
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
        voiceEnabled: false,
        imageEnabled: false,
        avatarData: null,
        createdAt: '',
        updatedAt: '',
      },
    ]);

    const context = createMockContext(null, 'mine');
    await handleBrowse(context, mockConfig);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    // Should only show owned characters
    expect(embedData.description).toContain('My Character');
    expect(embedData.description).not.toContain('Other Character');
  });

  it('should filter by public only', async () => {
    vi.mocked(api.fetchUserCharacters).mockResolvedValue([
      {
        id: 'char-1',
        name: 'Private Char',
        slug: 'private-char',
        displayName: null,
        isPublic: false,
        ownerId: '123456789',
        characterInfo: '',
        personalityTraits: '',
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
        voiceEnabled: false,
        imageEnabled: false,
        avatarData: null,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'char-2',
        name: 'Public Char',
        slug: 'public-char',
        displayName: null,
        isPublic: true,
        ownerId: '123456789',
        characterInfo: '',
        personalityTraits: '',
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
        voiceEnabled: false,
        imageEnabled: false,
        avatarData: null,
        createdAt: '',
        updatedAt: '',
      },
    ]);

    const context = createMockContext(null, 'public');
    await handleBrowse(context, mockConfig);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    // Should only show public characters
    expect(embedData.description).not.toContain('Private Char');
    expect(embedData.description).toContain('Public Char');
  });

  it('should search by query', async () => {
    vi.mocked(api.fetchUserCharacters).mockResolvedValue([
      {
        id: 'char-1',
        name: 'Alice Character',
        slug: 'alice-char',
        displayName: null,
        isPublic: false,
        ownerId: '123456789',
        characterInfo: '',
        personalityTraits: '',
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
        voiceEnabled: false,
        imageEnabled: false,
        avatarData: null,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'char-2',
        name: 'Bob Character',
        slug: 'bob-char',
        displayName: null,
        isPublic: false,
        ownerId: '123456789',
        characterInfo: '',
        personalityTraits: '',
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
        voiceEnabled: false,
        imageEnabled: false,
        avatarData: null,
        createdAt: '',
        updatedAt: '',
      },
    ]);

    const context = createMockContext('alice', null);
    await handleBrowse(context, mockConfig);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    // Should only show matching characters
    expect(embedData.description).toContain('Alice Character');
    expect(embedData.description).not.toContain('Bob Character');
    expect(embedData.description).toContain('Searching: "alice"');
  });

  it('should show empty state when user has no characters', async () => {
    const context = createMockContext();
    await handleBrowse(context, mockConfig);

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining("You don't have any characters yet"),
            }),
          }),
        ]),
      })
    );
  });

  it('should show no results message when filter produces empty results', async () => {
    vi.mocked(api.fetchPublicCharacters).mockResolvedValue([
      {
        id: 'char-1',
        name: 'Other Character',
        slug: 'other-char',
        displayName: null,
        isPublic: true,
        ownerId: 'other-user',
        characterInfo: '',
        personalityTraits: '',
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
        voiceEnabled: false,
        imageEnabled: false,
        avatarData: null,
        createdAt: '',
        updatedAt: '',
      },
    ]);

    // Filter by mine when user has no characters
    const context = createMockContext(null, 'mine');
    await handleBrowse(context, mockConfig);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    expect(embedData.description).toContain("You don't have any characters yet");
  });

  it('should handle API errors gracefully', async () => {
    vi.mocked(api.fetchUserCharacters).mockRejectedValue(new Error('API error'));

    const context = createMockContext();
    await handleBrowse(context, mockConfig);

    expect(mockEditReply).toHaveBeenCalledWith('❌ Failed to load characters. Please try again.');
  });

  it('should show Other Users section with public characters from others', async () => {
    vi.mocked(api.fetchUserCharacters).mockResolvedValue([
      {
        id: 'char-1',
        name: 'My Character',
        slug: 'my-char',
        displayName: null,
        isPublic: false,
        ownerId: '123456789',
        characterInfo: '',
        personalityTraits: '',
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
        voiceEnabled: false,
        imageEnabled: false,
        avatarData: null,
        createdAt: '',
        updatedAt: '',
      },
    ]);
    vi.mocked(api.fetchPublicCharacters).mockResolvedValue([
      {
        id: 'char-2',
        name: 'Public Char',
        slug: 'public-char',
        displayName: null,
        isPublic: true,
        ownerId: 'other-user-id',
        characterInfo: '',
        personalityTraits: '',
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
        voiceEnabled: false,
        imageEnabled: false,
        avatarData: null,
        createdAt: '',
        updatedAt: '',
      },
    ]);
    vi.mocked(api.fetchUsernames).mockResolvedValue(new Map([['other-user-id', 'OtherUser']]));

    const context = createMockContext();
    await handleBrowse(context, mockConfig);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    // Should show both sections
    expect(embedData.description).toContain('My Character');
    expect(embedData.description).toContain('Public Char');
    // Should show Other Users header
    expect(embedData.description).toContain('Other Users');
  });

  it('should show search filter in description when query is used', async () => {
    vi.mocked(api.fetchUserCharacters).mockResolvedValue([
      {
        id: 'char-1',
        name: 'My Character',
        slug: 'my-char',
        displayName: null,
        isPublic: false,
        ownerId: '123456789',
        characterInfo: '',
        personalityTraits: '',
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
        voiceEnabled: false,
        imageEnabled: false,
        avatarData: null,
        createdAt: '',
        updatedAt: '',
      },
    ]);

    // Search for something that doesn't match
    const context = createMockContext('nonexistent', null);
    await handleBrowse(context, mockConfig);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    // Should show search term in description
    expect(embedData.description).toContain('Searching: "nonexistent"');
  });
});

describe('handleBrowsePagination', () => {
  const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchUserCharacters).mockResolvedValue([]);
    vi.mocked(api.fetchPublicCharacters).mockResolvedValue([]);
    vi.mocked(api.fetchUsernames).mockResolvedValue(new Map());
  });

  function createMockButtonInteraction(customId: string) {
    return {
      customId,
      user: { id: '123456789' },
      client: {
        users: {
          fetch: vi.fn(),
        },
      },
      deferUpdate: vi.fn(),
      editReply: vi.fn(),
    } as unknown as ButtonInteraction;
  }

  it('should defer update on pagination', async () => {
    const mockInteraction = createMockButtonInteraction('character::browse::1::all::date::');
    await handleBrowsePagination(mockInteraction, mockConfig);

    expect(mockInteraction.deferUpdate).toHaveBeenCalled();
  });

  it('should refresh data on pagination', async () => {
    const mockInteraction = createMockButtonInteraction('character::browse::1::all::date::');
    await handleBrowsePagination(mockInteraction, mockConfig);

    expect(api.fetchUserCharacters).toHaveBeenCalledWith('123456789', mockConfig);
    expect(api.fetchPublicCharacters).toHaveBeenCalledWith('123456789', mockConfig);
  });

  it('should handle errors gracefully without crashing', async () => {
    vi.mocked(api.fetchUserCharacters).mockRejectedValue(new Error('API error'));

    const mockInteraction = createMockButtonInteraction('character::browse::1::all::date::');

    // Should not throw
    await expect(handleBrowsePagination(mockInteraction, mockConfig)).resolves.not.toThrow();

    // Should not call editReply on error (keeps existing content)
    expect(mockInteraction.editReply).not.toHaveBeenCalled();
  });

  it('should return early for invalid custom ID', async () => {
    const mockInteraction = createMockButtonInteraction('invalid::custom::id');
    await handleBrowsePagination(mockInteraction, mockConfig);

    expect(mockInteraction.deferUpdate).not.toHaveBeenCalled();
    expect(api.fetchUserCharacters).not.toHaveBeenCalled();
  });

  it('should apply sort from custom ID', async () => {
    vi.mocked(api.fetchUserCharacters).mockResolvedValue([
      {
        id: 'char-1',
        name: 'Alpha Char',
        slug: 'alpha-char',
        displayName: null,
        isPublic: false,
        ownerId: '123456789',
        characterInfo: '',
        personalityTraits: '',
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
        voiceEnabled: false,
        imageEnabled: false,
        avatarData: null,
        createdAt: '2025-01-01',
        updatedAt: '',
      },
      {
        id: 'char-2',
        name: 'Zeta Char',
        slug: 'zeta-char',
        displayName: null,
        isPublic: false,
        ownerId: '123456789',
        characterInfo: '',
        personalityTraits: '',
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
        voiceEnabled: false,
        imageEnabled: false,
        avatarData: null,
        createdAt: '2025-06-01',
        updatedAt: '',
      },
    ]);

    const mockInteraction = createMockButtonInteraction('character::browse::0::all::name::');
    await handleBrowsePagination(mockInteraction, mockConfig);

    // Should call editReply with name sort
    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              footer: expect.objectContaining({
                text: expect.stringContaining('alphabetically'),
              }),
            }),
          }),
        ]),
      })
    );
  });

  it('should apply query filter from custom ID', async () => {
    vi.mocked(api.fetchUserCharacters).mockResolvedValue([
      {
        id: 'char-1',
        name: 'Luna',
        slug: 'luna',
        displayName: null,
        isPublic: false,
        ownerId: '123456789',
        characterInfo: '',
        personalityTraits: '',
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
        voiceEnabled: false,
        imageEnabled: false,
        avatarData: null,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'char-2',
        name: 'Other',
        slug: 'other',
        displayName: null,
        isPublic: false,
        ownerId: '123456789',
        characterInfo: '',
        personalityTraits: '',
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
        voiceEnabled: false,
        imageEnabled: false,
        avatarData: null,
        createdAt: '',
        updatedAt: '',
      },
    ]);

    const mockInteraction = createMockButtonInteraction('character::browse::0::all::date::luna');
    await handleBrowsePagination(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining('Luna'),
            }),
          }),
        ]),
      })
    );
  });
});

describe('isCharacterBrowseInteraction', () => {
  it('should return true for browse custom IDs', () => {
    expect(isCharacterBrowseInteraction('character::browse::0::all::date::')).toBe(true);
  });

  it('should return false for non-browse custom IDs', () => {
    expect(isCharacterBrowseInteraction('character::menu::123')).toBe(false);
  });
});

describe('isCharacterBrowseSelectInteraction', () => {
  it('should return true for browse-select custom IDs', () => {
    expect(isCharacterBrowseSelectInteraction('character::browse-select')).toBe(true);
  });

  it('should return false for browse pagination custom IDs', () => {
    expect(isCharacterBrowseSelectInteraction('character::browse::0::all::date::')).toBe(false);
  });

  it('should return false for non-browse custom IDs', () => {
    expect(isCharacterBrowseSelectInteraction('character::menu::123')).toBe(false);
  });
});

describe('handleBrowseSelect', () => {
  const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionSet.mockResolvedValue(undefined);
  });

  function createMockSelectInteraction(slug: string) {
    return {
      customId: 'character::browse-select',
      values: [slug],
      user: { id: '123456789' },
      message: { id: 'message-123' },
      channelId: 'channel-123',
      deferUpdate: vi.fn(),
      editReply: vi.fn(),
    } as unknown as StringSelectMenuInteraction;
  }

  function createMockCharacter(overrides = {}) {
    return {
      id: 'char-123',
      name: 'Luna',
      slug: 'luna',
      displayName: 'Luna the Cat',
      isPublic: true,
      ownerId: '123456789',
      canEdit: true,
      characterInfo: 'A friendly cat',
      personalityTraits: 'playful, curious',
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
      voiceEnabled: false,
      imageEnabled: false,
      avatarData: null,
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
      ...overrides,
    };
  }

  it('should defer update and fetch character', async () => {
    const mockCharacter = createMockCharacter();
    vi.mocked(api.fetchCharacter).mockResolvedValue(mockCharacter);

    const interaction = createMockSelectInteraction('luna');
    await handleBrowseSelect(interaction, mockConfig);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(api.fetchCharacter).toHaveBeenCalledWith('luna', mockConfig, '123456789');
  });

  it('should open dashboard when character is found', async () => {
    const mockCharacter = createMockCharacter();
    vi.mocked(api.fetchCharacter).mockResolvedValue(mockCharacter);

    const interaction = createMockSelectInteraction('luna');
    await handleBrowseSelect(interaction, mockConfig);

    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('should create session for dashboard tracking', async () => {
    const mockCharacter = createMockCharacter();
    vi.mocked(api.fetchCharacter).mockResolvedValue(mockCharacter);

    const interaction = createMockSelectInteraction('luna');
    await handleBrowseSelect(interaction, mockConfig);

    expect(mockSessionSet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '123456789',
        entityType: 'character',
        entityId: 'luna',
        messageId: 'message-123',
        channelId: 'channel-123',
      })
    );
  });

  it('should show error when character not found', async () => {
    vi.mocked(api.fetchCharacter).mockResolvedValue(null);

    const interaction = createMockSelectInteraction('nonexistent');
    await handleBrowseSelect(interaction, mockConfig);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '❌ Character not found or you do not have access.',
      embeds: [],
      components: [],
    });
    expect(mockSessionSet).not.toHaveBeenCalled();
  });

  it('should handle API errors gracefully', async () => {
    vi.mocked(api.fetchCharacter).mockRejectedValue(new Error('API error'));

    const interaction = createMockSelectInteraction('luna');
    await handleBrowseSelect(interaction, mockConfig);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '❌ Failed to load character. Please try again.',
      embeds: [],
      components: [],
    });
  });
});
