/**
 * Tests for Character Autocomplete Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAutocomplete } from './autocomplete.js';
import type { PersonalitySummary } from '@tzurot/common-types';

// Mock the autocomplete cache (character/autocomplete uses handlePersonalityAutocomplete which uses the cache)
const mockGetCachedPersonalities = vi.fn();
vi.mock('../../utils/autocomplete/autocompleteCache.js', () => ({
  getCachedPersonalities: (...args: unknown[]) => mockGetCachedPersonalities(...args),
}));

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

function createMockPersonality(overrides: Partial<PersonalitySummary> = {}): PersonalitySummary {
  return {
    id: 'test-id',
    slug: 'test-slug',
    name: 'Test',
    displayName: null,
    isOwned: true,
    isPublic: false,
    ...overrides,
  };
}

describe('handleAutocomplete', () => {
  const mockRespond = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRespond.mockResolvedValue(undefined);
  });

  function createMockInteraction(
    focusedName: string,
    focusedValue: string,
    subcommand: string | null = 'edit'
  ) {
    return {
      user: { id: '123456789' },
      guildId: 'guild-123',
      commandName: 'character',
      options: {
        getFocused: vi.fn().mockReturnValue({
          name: focusedName,
          value: focusedValue,
        }),
        getSubcommand: vi.fn().mockReturnValue(subcommand),
      },
      respond: mockRespond,
    } as any;
  }

  it('should return empty array for non-character focused option', async () => {
    await handleAutocomplete(createMockInteraction('other-field', 'test'));

    expect(mockRespond).toHaveBeenCalledWith([]);
    expect(mockGetCachedPersonalities).not.toHaveBeenCalled();
  });

  it('should return owned characters for edit subcommand', async () => {
    mockGetCachedPersonalities.mockResolvedValue([
      createMockPersonality({
        slug: 'my-char',
        name: 'MyChar',
        displayName: 'My Character',
        isOwned: true,
        isPublic: false,
      }),
      createMockPersonality({
        slug: 'public-char',
        name: 'PublicChar',
        displayName: null,
        isOwned: false,
        isPublic: true,
      }),
    ]);

    await handleAutocomplete(createMockInteraction('character', '', 'edit'));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: '🔒 My Character (my-char)', value: 'my-char' },
    ]);
  });

  it('should return owned characters for avatar subcommand', async () => {
    mockGetCachedPersonalities.mockResolvedValue([
      createMockPersonality({
        slug: 'my-char',
        name: 'MyChar',
        displayName: null,
        isOwned: true,
        isPublic: true,
      }),
      createMockPersonality({
        slug: 'other',
        name: 'Other',
        displayName: null,
        isOwned: false,
        isPublic: true,
      }),
    ]);

    await handleAutocomplete(createMockInteraction('character', '', 'avatar'));

    expect(mockRespond).toHaveBeenCalledWith([{ name: '🌐 MyChar (my-char)', value: 'my-char' }]);
  });

  it('should return all characters for view subcommand', async () => {
    mockGetCachedPersonalities.mockResolvedValue([
      createMockPersonality({
        slug: 'my-char',
        name: 'MyChar',
        displayName: null,
        isOwned: true,
        isPublic: false,
      }),
      createMockPersonality({
        slug: 'public-char',
        name: 'PublicChar',
        displayName: 'Public Bot',
        isOwned: false,
        isPublic: true,
      }),
    ]);

    await handleAutocomplete(createMockInteraction('character', '', 'view'));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: '🔒 MyChar (my-char)', value: 'my-char' },
      { name: '📖 Public Bot (public-char)', value: 'public-char' },
    ]);
  });

  it('should filter by query matching name', async () => {
    mockGetCachedPersonalities.mockResolvedValue([
      createMockPersonality({
        slug: 'luna',
        name: 'Luna',
        displayName: null,
        isOwned: true,
        isPublic: true,
      }),
      createMockPersonality({
        slug: 'lilith',
        name: 'Lilith',
        displayName: null,
        isOwned: true,
        isPublic: true,
      }),
    ]);

    await handleAutocomplete(createMockInteraction('character', 'lun', 'edit'));

    expect(mockRespond).toHaveBeenCalledWith([{ name: '🌐 Luna (luna)', value: 'luna' }]);
  });

  it('should filter by query matching slug', async () => {
    mockGetCachedPersonalities.mockResolvedValue([
      createMockPersonality({
        slug: 'my-bot-123',
        name: 'Bot',
        displayName: null,
        isOwned: true,
        isPublic: false,
      }),
      createMockPersonality({
        slug: 'other',
        name: 'Other',
        displayName: null,
        isOwned: true,
        isPublic: false,
      }),
    ]);

    await handleAutocomplete(createMockInteraction('character', 'bot-123', 'edit'));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: '🔒 Bot (my-bot-123)', value: 'my-bot-123' },
    ]);
  });

  it('should filter by query matching displayName', async () => {
    mockGetCachedPersonalities.mockResolvedValue([
      createMockPersonality({
        slug: 'char-1',
        name: 'Internal',
        displayName: 'Fancy Display Name',
        isOwned: true,
        isPublic: true,
      }),
      createMockPersonality({
        slug: 'char-2',
        name: 'Other',
        displayName: null,
        isOwned: true,
        isPublic: true,
      }),
    ]);

    await handleAutocomplete(createMockInteraction('character', 'fancy', 'edit'));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: '🌐 Fancy Display Name (char-1)', value: 'char-1' },
    ]);
  });

  it('should handle case-insensitive query', async () => {
    mockGetCachedPersonalities.mockResolvedValue([
      createMockPersonality({
        slug: 'luna',
        name: 'Luna',
        displayName: null,
        isOwned: true,
        isPublic: true,
      }),
    ]);

    await handleAutocomplete(createMockInteraction('character', 'LUNA', 'edit'));

    expect(mockRespond).toHaveBeenCalledWith([{ name: '🌐 Luna (luna)', value: 'luna' }]);
  });

  it('should return empty array when cache returns empty', async () => {
    mockGetCachedPersonalities.mockResolvedValue([]);

    await handleAutocomplete(createMockInteraction('character', ''));

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should handle errors gracefully', async () => {
    mockGetCachedPersonalities.mockRejectedValue(new Error('Cache error'));

    await handleAutocomplete(createMockInteraction('character', ''));

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should limit results to Discord max choices', async () => {
    // Create 30 characters
    const personalities = Array.from({ length: 30 }, (_, i) =>
      createMockPersonality({
        slug: `char-${i}`,
        name: `Character ${i}`,
        displayName: null,
        isOwned: true,
        isPublic: true,
      })
    );

    mockGetCachedPersonalities.mockResolvedValue(personalities);

    await handleAutocomplete(createMockInteraction('character', '', 'edit'));

    const call = mockRespond.mock.calls[0][0];
    expect(call.length).toBe(25); // DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES
  });

  it('should show correct visibility icons', async () => {
    mockGetCachedPersonalities.mockResolvedValue([
      createMockPersonality({
        slug: 'private-owned',
        name: 'Private',
        displayName: null,
        isOwned: true,
        isPublic: false,
      }),
      createMockPersonality({
        slug: 'public-owned',
        name: 'Public',
        displayName: null,
        isOwned: true,
        isPublic: true,
      }),
      createMockPersonality({
        slug: 'public-other',
        name: 'Other',
        displayName: null,
        isOwned: false,
        isPublic: true,
      }),
    ]);

    await handleAutocomplete(createMockInteraction('character', '', 'view'));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: '🔒 Private (private-owned)', value: 'private-owned' },
      { name: '🌐 Public (public-owned)', value: 'public-owned' },
      { name: '📖 Other (public-other)', value: 'public-other' },
    ]);
  });
});
