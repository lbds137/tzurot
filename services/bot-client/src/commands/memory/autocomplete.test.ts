/**
 * Tests for Memory Command Autocomplete
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handlePersonalityAutocomplete,
  resolvePersonalityId,
  getPersonalityName,
} from './autocomplete.js';
import type { AutocompleteInteraction } from 'discord.js';
import type { UserClient } from '@tzurot/clients';

function mkUser(discordId = 'user-123'): UserClient {
  // Cache-key only — `actor` is the field getCachedPersonalities reads via
  // the mocked autocompleteCache module.
  return { actor: discordId } as unknown as UserClient;
}

// Mock shared autocomplete utility
const mockSharedAutocomplete = vi.fn();
vi.mock('../../utils/autocomplete/personalityAutocomplete.js', () => ({
  handlePersonalityAutocomplete: (...args: unknown[]) => mockSharedAutocomplete(...args),
}));

// Mock autocomplete cache
const mockGetCachedPersonalities = vi.fn();
vi.mock('../../utils/autocomplete/autocompleteCache.js', () => ({
  getCachedPersonalities: (...args: unknown[]) => mockGetCachedPersonalities(...args),
}));

describe('Memory Autocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handlePersonalityAutocomplete', () => {
    it('should delegate to shared autocomplete with correct options', async () => {
      const mockInteraction = {} as AutocompleteInteraction;

      await handlePersonalityAutocomplete(mockInteraction);

      expect(mockSharedAutocomplete).toHaveBeenCalledWith(mockInteraction, {
        optionName: 'character',
        showVisibility: true,
        ownedOnly: false,
        valueField: 'slug',
      });
    });
  });

  describe('resolvePersonalityId', () => {
    const mockPersonalities = [
      { id: 'uuid-1', slug: 'lilith', name: 'Lilith', displayName: 'Lilith the Dark' },
      { id: 'uuid-2', slug: 'aria', name: 'Aria', displayName: null },
      { id: 'uuid-3', slug: 'zephyr', name: 'Zephyr', displayName: 'Zephyr Wind' },
    ];

    beforeEach(() => {
      mockGetCachedPersonalities.mockResolvedValue({ kind: 'ok', value: mockPersonalities });
    });

    it('should resolve personality by slug', async () => {
      const user = mkUser();
      const result = await resolvePersonalityId(user, 'lilith');

      expect(result).toEqual({ kind: 'found', id: 'uuid-1' });
      expect(mockGetCachedPersonalities).toHaveBeenCalledWith(user);
    });

    it('should resolve personality by ID', async () => {
      const result = await resolvePersonalityId(mkUser(), 'uuid-2');

      expect(result).toEqual({ kind: 'found', id: 'uuid-2' });
    });

    it('should resolve personality by name (case-insensitive)', async () => {
      const result = await resolvePersonalityId(mkUser(), 'ZEPHYR');

      expect(result).toEqual({ kind: 'found', id: 'uuid-3' });
    });

    it('should return not-found for an unknown personality (list loaded, no match)', async () => {
      const result = await resolvePersonalityId(mkUser(), 'unknown');

      expect(result).toEqual({ kind: 'not-found' });
    });

    it('should prefer slug match over name match', async () => {
      // Add a personality where slug differs from name
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [...mockPersonalities, { id: 'uuid-special', slug: 'aria', name: 'Different Name' }],
      });

      // First match by slug wins
      const result = await resolvePersonalityId(mkUser(), 'aria');

      // Should find the original 'aria' by slug first
      expect(result).toEqual({ kind: 'found', id: 'uuid-2' });
    });

    it('should return unavailable when the personality list can not be fetched (infra)', async () => {
      mockGetCachedPersonalities.mockResolvedValue({ kind: 'error', error: 'Backend down' });

      const result = await resolvePersonalityId(mkUser(), 'lilith');

      expect(result).toEqual({ kind: 'unavailable' });
    });
  });

  describe('getPersonalityName', () => {
    const mockPersonalities = [
      { id: 'uuid-1', slug: 'lilith', name: 'Lilith', displayName: 'Lilith the Dark' },
      { id: 'uuid-2', slug: 'aria', name: 'Aria', displayName: null },
      { id: 'uuid-3', slug: 'zephyr', name: 'Zephyr' },
    ];

    beforeEach(() => {
      mockGetCachedPersonalities.mockResolvedValue({ kind: 'ok', value: mockPersonalities });
    });

    it('should return displayName when available', async () => {
      const user = mkUser();
      const result = await getPersonalityName(user, 'uuid-1');

      expect(result).toBe('Lilith the Dark');
      expect(mockGetCachedPersonalities).toHaveBeenCalledWith(user);
    });

    it('should return name when displayName is null', async () => {
      const result = await getPersonalityName(mkUser(), 'uuid-2');

      expect(result).toBe('Aria');
    });

    it('should return name when displayName is undefined', async () => {
      const result = await getPersonalityName(mkUser(), 'uuid-3');

      expect(result).toBe('Zephyr');
    });

    it('should return null for unknown personality', async () => {
      const result = await getPersonalityName(mkUser(), 'unknown-uuid');

      expect(result).toBeNull();
    });

    it('should return null when cache returns error', async () => {
      mockGetCachedPersonalities.mockResolvedValue({ kind: 'error', error: 'Backend down' });

      const result = await getPersonalityName(mkUser(), 'uuid-1');

      expect(result).toBeNull();
    });
  });
});
