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
        optionName: 'personality',
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
      mockGetCachedPersonalities.mockResolvedValue(mockPersonalities);
    });

    it('should resolve personality by slug', async () => {
      const result = await resolvePersonalityId('user-123', 'lilith');

      expect(result).toBe('uuid-1');
      expect(mockGetCachedPersonalities).toHaveBeenCalledWith('user-123');
    });

    it('should resolve personality by ID', async () => {
      const result = await resolvePersonalityId('user-123', 'uuid-2');

      expect(result).toBe('uuid-2');
    });

    it('should resolve personality by name (case-insensitive)', async () => {
      const result = await resolvePersonalityId('user-123', 'ZEPHYR');

      expect(result).toBe('uuid-3');
    });

    it('should return null for unknown personality', async () => {
      const result = await resolvePersonalityId('user-123', 'unknown');

      expect(result).toBeNull();
    });

    it('should prefer slug match over name match', async () => {
      // Add a personality where slug differs from name
      mockGetCachedPersonalities.mockResolvedValue([
        ...mockPersonalities,
        { id: 'uuid-special', slug: 'aria', name: 'Different Name' },
      ]);

      // First match by slug wins
      const result = await resolvePersonalityId('user-123', 'aria');

      // Should find the original 'aria' by slug first
      expect(result).toBe('uuid-2');
    });
  });

  describe('getPersonalityName', () => {
    const mockPersonalities = [
      { id: 'uuid-1', slug: 'lilith', name: 'Lilith', displayName: 'Lilith the Dark' },
      { id: 'uuid-2', slug: 'aria', name: 'Aria', displayName: null },
      { id: 'uuid-3', slug: 'zephyr', name: 'Zephyr' },
    ];

    beforeEach(() => {
      mockGetCachedPersonalities.mockResolvedValue(mockPersonalities);
    });

    it('should return displayName when available', async () => {
      const result = await getPersonalityName('user-123', 'uuid-1');

      expect(result).toBe('Lilith the Dark');
      expect(mockGetCachedPersonalities).toHaveBeenCalledWith('user-123');
    });

    it('should return name when displayName is null', async () => {
      const result = await getPersonalityName('user-123', 'uuid-2');

      expect(result).toBe('Aria');
    });

    it('should return name when displayName is undefined', async () => {
      const result = await getPersonalityName('user-123', 'uuid-3');

      expect(result).toBe('Zephyr');
    });

    it('should return null for unknown personality', async () => {
      const result = await getPersonalityName('user-123', 'unknown-uuid');

      expect(result).toBeNull();
    });
  });
});
