/**
 * Tests for Shared Personality Autocomplete Utility
 * Tests gateway API calls, filtering, visibility indicators, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePersonalityAutocomplete, getVisibilityIcon } from './personalityAutocomplete.js';
import type { PersonalitySummary } from '@tzurot/common-types';
import { AUTOCOMPLETE_ERROR_SENTINEL } from '../apiCheck.js';

// Mock the autocomplete cache
const mockGetCachedPersonalities = vi.fn();
vi.mock('./autocompleteCache.js', () => ({
  getCachedPersonalities: (...args: unknown[]) => mockGetCachedPersonalities(...args),
}));

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

describe('handlePersonalityAutocomplete', () => {
  const mockRespond = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRespond.mockResolvedValue(undefined);
  });

  function createMockInteraction(focusedName: string, focusedValue: string) {
    return {
      user: { id: '123456789', username: 'testuser', globalName: 'Test User' },
      guildId: 'guild-123',
      options: {
        getFocused: vi.fn().mockReturnValue({
          name: focusedName,
          value: focusedValue,
        }),
      },
      respond: mockRespond,
    } as any;
  }

  function createMockPersonality(overrides: Partial<PersonalitySummary> = {}): PersonalitySummary {
    const isOwned = overrides.isOwned ?? true;
    return {
      id: 'personality-1',
      name: 'Test Personality',
      slug: 'test-personality',
      displayName: null,
      isPublic: false,
      isOwned,
      ownerId: 'owner-123',
      ownerDiscordId: 'discord-123',
      permissions: { canEdit: isOwned, canDelete: isOwned },
      ...overrides,
    };
  }

  describe('option name matching', () => {
    it('should return false for non-matching option names', async () => {
      const interaction = createMockInteraction('other-option', 'test');

      const handled = await handlePersonalityAutocomplete(interaction);

      expect(handled).toBe(false);
      expect(mockRespond).not.toHaveBeenCalled();
      expect(mockGetCachedPersonalities).not.toHaveBeenCalled();
    });

    it('should return true for "personality" option name by default', async () => {
      mockGetCachedPersonalities.mockResolvedValue({ kind: 'ok', value: [] });

      const interaction = createMockInteraction('personality', '');
      const handled = await handlePersonalityAutocomplete(interaction);

      expect(handled).toBe(true);
      expect(mockGetCachedPersonalities).toHaveBeenCalled();
    });

    it('should return true for "character" option name by default', async () => {
      mockGetCachedPersonalities.mockResolvedValue({ kind: 'ok', value: [] });

      const interaction = createMockInteraction('character', '');
      const handled = await handlePersonalityAutocomplete(interaction);

      expect(handled).toBe(true);
      expect(mockGetCachedPersonalities).toHaveBeenCalled();
    });

    it('should match custom single option name', async () => {
      mockGetCachedPersonalities.mockResolvedValue({ kind: 'ok', value: [] });

      const interaction = createMockInteraction('ai-persona', '');
      const handled = await handlePersonalityAutocomplete(interaction, {
        optionName: 'ai-persona',
      });

      expect(handled).toBe(true);
    });

    it('should match custom array of option names', async () => {
      mockGetCachedPersonalities.mockResolvedValue({ kind: 'ok', value: [] });

      const interaction = createMockInteraction('bot', '');
      const handled = await handlePersonalityAutocomplete(interaction, {
        optionName: ['bot', 'ai', 'assistant'],
      });

      expect(handled).toBe(true);
    });

    it('should not match non-matching custom option name', async () => {
      const interaction = createMockInteraction('personality', '');
      const handled = await handlePersonalityAutocomplete(interaction, {
        optionName: 'different-option',
      });

      expect(handled).toBe(false);
      expect(mockGetCachedPersonalities).not.toHaveBeenCalled();
    });
  });

  describe('cache usage', () => {
    it('should call cache with correct user ID', async () => {
      mockGetCachedPersonalities.mockResolvedValue({ kind: 'ok', value: [] });

      const interaction = createMockInteraction('personality', '');
      await handlePersonalityAutocomplete(interaction);

      expect(mockGetCachedPersonalities).toHaveBeenCalledWith({
        discordId: '123456789',
        username: 'testuser',
        displayName: 'Test User',
      });
    });

    it('should return empty array when cache returns empty', async () => {
      mockGetCachedPersonalities.mockResolvedValue({ kind: 'ok', value: [] });

      const interaction = createMockInteraction('personality', '');
      const handled = await handlePersonalityAutocomplete(interaction);

      expect(handled).toBe(true);
      expect(mockRespond).toHaveBeenCalledWith([]);
    });

    it('should handle thrown errors gracefully', async () => {
      mockGetCachedPersonalities.mockRejectedValue(new Error('Cache error'));

      const interaction = createMockInteraction('personality', '');
      const handled = await handlePersonalityAutocomplete(interaction);

      expect(handled).toBe(true);
      expect(mockRespond).toHaveBeenCalledWith([]);
    });

    it('should render error placeholder when cache returns { kind: "error" }', async () => {
      // Cache's own error path (transient with no stale fallback, or
      // permanent) — distinct from the throw path above. The handler must
      // respond with a visible placeholder so the user doesn't see an
      // empty list that reads as "you have no personalities" during a
      // backend outage.
      mockGetCachedPersonalities.mockResolvedValue({ kind: 'error', error: 'Backend down' });

      const interaction = createMockInteraction('personality', '');
      const handled = await handlePersonalityAutocomplete(interaction);

      expect(handled).toBe(true);
      expect(mockRespond).toHaveBeenCalledWith([
        {
          name: '[Unable to load personalities — try again]',
          value: AUTOCOMPLETE_ERROR_SENTINEL,
        },
      ]);
    });
  });

  describe('filtering by ownership', () => {
    it('should return all personalities when ownedOnly is false', async () => {
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [
          createMockPersonality({ id: '1', name: 'Owned', slug: 'owned', isOwned: true }),
          createMockPersonality({
            id: '2',
            name: 'Not Owned',
            slug: 'not-owned',
            isOwned: false,
            isPublic: true,
          }),
        ],
      });

      const interaction = createMockInteraction('personality', '');
      await handlePersonalityAutocomplete(interaction, { ownedOnly: false });

      expect(mockRespond).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ value: 'owned' }),
          expect.objectContaining({ value: 'not-owned' }),
        ])
      );
    });

    it('should filter to only owned when ownedOnly is true', async () => {
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [
          createMockPersonality({ id: '1', name: 'Owned', slug: 'owned', isOwned: true }),
          createMockPersonality({
            id: '2',
            name: 'Not Owned',
            slug: 'not-owned',
            isOwned: false,
            isPublic: true,
          }),
        ],
      });

      const interaction = createMockInteraction('personality', '');
      await handlePersonalityAutocomplete(interaction, { ownedOnly: true });

      const calls = mockRespond.mock.calls[0][0];
      expect(calls).toHaveLength(1);
      expect(calls[0].value).toBe('owned');
    });
  });

  describe('filtering by query', () => {
    const testPersonalities: PersonalitySummary[] = [
      createMockPersonality({
        id: '1',
        name: 'Lilith',
        slug: 'lilith',
        displayName: 'Lilith the Dark',
      }),
      createMockPersonality({
        id: '2',
        name: 'Aria',
        slug: 'aria-helper',
        displayName: 'Aria Assistant',
      }),
      createMockPersonality({ id: '3', name: 'Zephyr', slug: 'zephyr', displayName: null }),
    ];

    beforeEach(() => {
      mockGetCachedPersonalities.mockResolvedValue({ kind: 'ok', value: testPersonalities });
    });

    it('should return all personalities when query is empty', async () => {
      const interaction = createMockInteraction('personality', '');
      await handlePersonalityAutocomplete(interaction);

      const calls = mockRespond.mock.calls[0][0];
      expect(calls).toHaveLength(3);
    });

    it('should filter by name match', async () => {
      const interaction = createMockInteraction('personality', 'lil');
      await handlePersonalityAutocomplete(interaction);

      const calls = mockRespond.mock.calls[0][0];
      expect(calls).toHaveLength(1);
      expect(calls[0].value).toBe('lilith');
    });

    it('should filter by slug match', async () => {
      const interaction = createMockInteraction('personality', 'helper');
      await handlePersonalityAutocomplete(interaction);

      const calls = mockRespond.mock.calls[0][0];
      expect(calls).toHaveLength(1);
      expect(calls[0].value).toBe('aria-helper');
    });

    it('should filter by displayName match', async () => {
      const interaction = createMockInteraction('personality', 'assistant');
      await handlePersonalityAutocomplete(interaction);

      const calls = mockRespond.mock.calls[0][0];
      expect(calls).toHaveLength(1);
      expect(calls[0].value).toBe('aria-helper');
    });

    it('should be case-insensitive', async () => {
      const interaction = createMockInteraction('personality', 'ZEPHYR');
      await handlePersonalityAutocomplete(interaction);

      const calls = mockRespond.mock.calls[0][0];
      expect(calls).toHaveLength(1);
      expect(calls[0].value).toBe('zephyr');
    });

    it('should return empty when no matches', async () => {
      const interaction = createMockInteraction('personality', 'nonexistent');
      await handlePersonalityAutocomplete(interaction);

      expect(mockRespond).toHaveBeenCalledWith([]);
    });
  });

  describe('visibility indicators', () => {
    it('should add visibility indicators by default', async () => {
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [
          createMockPersonality({
            name: 'Public Owned',
            slug: 'public-owned',
            isPublic: true,
            isOwned: true,
          }),
          createMockPersonality({
            name: 'Private Owned',
            slug: 'private-owned',
            isPublic: false,
            isOwned: true,
          }),
          createMockPersonality({
            name: 'Public Not Owned',
            slug: 'public-not-owned',
            isPublic: true,
            isOwned: false,
          }),
        ],
      });

      const interaction = createMockInteraction('personality', '');
      await handlePersonalityAutocomplete(interaction);

      expect(mockRespond).toHaveBeenCalledWith([
        { name: '🌐 Public Owned (public-owned)', value: 'public-owned' },
        { name: '🔒 Private Owned (private-owned)', value: 'private-owned' },
        { name: '📖 Public Not Owned (public-not-owned)', value: 'public-not-owned' },
      ]);
    });

    it('should use displayName when available', async () => {
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [
          createMockPersonality({
            name: 'Internal Name',
            slug: 'test',
            displayName: 'Beautiful Display Name',
            isPublic: true,
            isOwned: true,
          }),
        ],
      });

      const interaction = createMockInteraction('personality', '');
      await handlePersonalityAutocomplete(interaction);

      expect(mockRespond).toHaveBeenCalledWith([
        { name: '🌐 Beautiful Display Name (test)', value: 'test' },
      ]);
    });

    it('should fall back to name when displayName is null', async () => {
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [
          createMockPersonality({
            name: 'Fallback Name',
            slug: 'fallback',
            displayName: null,
            isPublic: false,
            isOwned: true,
          }),
        ],
      });

      const interaction = createMockInteraction('personality', '');
      await handlePersonalityAutocomplete(interaction);

      expect(mockRespond).toHaveBeenCalledWith([
        { name: '🔒 Fallback Name (fallback)', value: 'fallback' },
      ]);
    });

    it('should omit visibility indicators when showVisibility is false', async () => {
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [
          createMockPersonality({
            name: 'Test',
            slug: 'test',
            isPublic: true,
            isOwned: true,
          }),
        ],
      });

      const interaction = createMockInteraction('personality', '');
      await handlePersonalityAutocomplete(interaction, { showVisibility: false });

      expect(mockRespond).toHaveBeenCalledWith([{ name: 'Test (test)', value: 'test' }]);
    });
  });

  describe('Discord limits', () => {
    it('should respect AUTOCOMPLETE_MAX_CHOICES limit', async () => {
      // Create 30 personalities (more than the 25 limit)
      const manyPersonalities = Array.from({ length: 30 }, (_, i) =>
        createMockPersonality({
          id: `p-${i}`,
          name: `Personality ${i}`,
          slug: `personality-${i}`,
        })
      );

      mockGetCachedPersonalities.mockResolvedValue({ kind: 'ok', value: manyPersonalities });

      const interaction = createMockInteraction('personality', '');
      await handlePersonalityAutocomplete(interaction, { showVisibility: false });

      const calls = mockRespond.mock.calls[0][0];
      expect(calls.length).toBeLessThanOrEqual(25);
    });
  });
});

describe('getVisibilityIcon', () => {
  it('should return 🌐 (PUBLIC) for public and can edit', () => {
    // 🌐 = user's public personality (can edit)
    expect(getVisibilityIcon(true, true)).toBe('🌐');
  });

  it('should return 🔒 (OWNED) for private and can edit', () => {
    // 🔒 = user's private personality (can edit)
    expect(getVisibilityIcon(true, false)).toBe('🔒');
  });

  it('should return 📖 (READ_ONLY) for cannot edit (public read-only)', () => {
    // 📖 = someone else's public personality
    expect(getVisibilityIcon(false, true)).toBe('📖');
  });

  it('should return 📖 (READ_ONLY) for cannot edit even if private', () => {
    // This case shouldn't happen in practice (private + cannot edit)
    // but the function should still handle it
    expect(getVisibilityIcon(false, false)).toBe('📖');
  });
});
