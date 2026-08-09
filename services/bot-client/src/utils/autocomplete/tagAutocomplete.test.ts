/**
 * Tests for the Shared Character-Tag Autocomplete Utility
 *
 * Covers option claiming, the count-sorted vocabulary and its labels, the
 * choice cap, query filtering, and the two failure paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AutocompleteInteraction } from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import type { PersonalitySummary } from '@tzurot/common-types/schemas/api/personality';
import { AUTOCOMPLETE_ERROR_SENTINEL } from '../apiCheck.js';

const mockGetCachedPersonalities = vi.fn();
vi.mock('./autocompleteCache.js', () => ({
  getCachedPersonalities: (...args: unknown[]) => mockGetCachedPersonalities(...args),
}));

vi.mock('../gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: {} })),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

import { handleTagAutocomplete } from './tagAutocomplete.js';

describe('handleTagAutocomplete', () => {
  const mockRespond = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRespond.mockResolvedValue(undefined);
  });

  const makeInteraction = (focusedName: string, focusedValue: string): AutocompleteInteraction =>
    ({
      user: { id: 'user-123' },
      guildId: 'guild-123',
      options: {
        getFocused: vi.fn().mockReturnValue({ name: focusedName, value: focusedValue }),
      },
      respond: mockRespond,
    }) as unknown as AutocompleteInteraction;

  const makeSummary = (slug: string, tags: string[]) =>
    ({
      id: `id-${slug}`,
      slug,
      name: slug,
      displayName: null,
      isOwned: true,
      isPublic: true,
      ownerId: 'user-123',
      ownerDiscordId: 'user-123',
      tags,
      permissions: { canEdit: true, canDelete: true },
      // Typed so a PersonalitySummary shape change breaks this at compile time.
    }) satisfies PersonalitySummary;

  const respondWith = (personalities: PersonalitySummary[]): void => {
    mockGetCachedPersonalities.mockResolvedValue({ kind: 'ok', value: personalities });
  };

  it('declines an option it does not own', async () => {
    const handled = await handleTagAutocomplete(makeInteraction('character', ''));

    expect(handled).toBe(false);
    expect(mockRespond).not.toHaveBeenCalled();
    expect(mockGetCachedPersonalities).not.toHaveBeenCalled();
  });

  it('claims the `tag` option by default', async () => {
    respondWith([makeSummary('a', ['fantasy'])]);

    expect(await handleTagAutocomplete(makeInteraction('tag', ''))).toBe(true);
  });

  it('claims a configured option name instead', async () => {
    respondWith([makeSummary('a', ['fantasy'])]);

    expect(await handleTagAutocomplete(makeInteraction('theme', ''), { optionName: 'theme' })).toBe(
      true
    );
    expect(await handleTagAutocomplete(makeInteraction('tag', ''), { optionName: 'theme' })).toBe(
      false
    );
  });

  it('offers the vocabulary most-used first, labelled with the count', async () => {
    // Names run counter to the count order so an alphabetical-only sort would
    // produce a different list — otherwise this assertion cannot distinguish
    // "sorted by count" from "sorted by name".
    respondWith([
      makeSummary('a', ['zeta', 'mid']),
      makeSummary('b', ['zeta']),
      makeSummary('c', ['zeta', 'mid']),
    ]);

    await handleTagAutocomplete(makeInteraction('tag', ''));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'zeta — 3 characters', value: 'zeta' },
      { name: 'mid — 2 characters', value: 'mid' },
    ]);
  });

  it('uses the singular noun for a tag on one character', async () => {
    respondWith([makeSummary('a', ['solo'])]);

    await handleTagAutocomplete(makeInteraction('tag', ''));

    expect(mockRespond).toHaveBeenCalledWith([{ name: 'solo — 1 character', value: 'solo' }]);
  });

  it('filters the vocabulary by what the user has typed', async () => {
    respondWith([makeSummary('a', ['fantasy', 'sci-fi', 'noir'])]);

    await handleTagAutocomplete(makeInteraction('tag', 'FI'));

    // Case-insensitive substring over the tag token: 'sci-fi' matches, 'noir' does not
    expect(mockRespond).toHaveBeenCalledWith([{ name: 'sci-fi — 1 character', value: 'sci-fi' }]);
  });

  it('normalizes the typed query the way the tag filter will, so "Sci Fi" finds "sci-fi"', async () => {
    respondWith([makeSummary('a', ['fantasy', 'sci-fi'])]);

    await handleTagAutocomplete(makeInteraction('tag', 'Sci Fi'));

    // A dropdown that says "nothing" for a query that would MATCH on submit
    // contradicts the filter it feeds.
    expect(mockRespond).toHaveBeenCalledWith([{ name: 'sci-fi — 1 character', value: 'sci-fi' }]);
  });

  it('responds with an empty list when nothing in the pool is tagged', async () => {
    respondWith([makeSummary('a', []), makeSummary('b', [])]);

    await handleTagAutocomplete(makeInteraction('tag', ''));

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('never exceeds Discord’s choice cap', async () => {
    const overCap = DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES + 10;
    respondWith([
      makeSummary(
        'a',
        Array.from({ length: overCap }, (_, i) => `tag-${i}`)
      ),
    ]);

    await handleTagAutocomplete(makeInteraction('tag', ''));

    expect(mockRespond.mock.calls[0][0]).toHaveLength(DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);
  });

  it('renders a visible error choice when the pool cannot be loaded', async () => {
    mockGetCachedPersonalities.mockResolvedValue({ kind: 'error', error: 'boom' });

    const handled = await handleTagAutocomplete(makeInteraction('tag', ''));

    // An empty list would read as "no tags exist" — a silent lie during an outage
    expect(handled).toBe(true);
    expect(mockRespond).toHaveBeenCalledWith([
      { name: '[Unable to load tags — try again]', value: AUTOCOMPLETE_ERROR_SENTINEL },
    ]);
  });

  it('degrades to an empty list when the lookup throws', async () => {
    mockGetCachedPersonalities.mockRejectedValue(new Error('network down'));

    const handled = await handleTagAutocomplete(makeInteraction('tag', ''));

    expect(handled).toBe(true);
    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('only aggregates the pool the cache returned', async () => {
    // The cache serves the ACCESSIBLE list; a tag carried solely by a character
    // outside it is structurally unreachable, which is what keeps a private
    // character from leaking its vocabulary.
    respondWith([makeSummary('accessible', ['visible'])]);

    await handleTagAutocomplete(makeInteraction('tag', ''));

    expect(mockRespond).toHaveBeenCalledWith([{ name: 'visible — 1 character', value: 'visible' }]);
  });
});
