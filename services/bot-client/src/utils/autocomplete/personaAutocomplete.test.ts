/**
 * Tests for Shared Persona Autocomplete Utility
 * Tests gateway API calls, filtering, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePersonaAutocomplete, CREATE_NEW_PERSONA_VALUE } from './personaAutocomplete.js';
import type { PersonaSummary } from './autocompleteCache.js';

// Test UUIDs for personas (must be valid UUID format: 4th segment starts with 8/9/a/b)
const PERSONA_ID_1 = '11111111-1111-4111-8111-111111111111';
const PERSONA_ID_2 = '22222222-2222-4222-8222-222222222222';
const PERSONA_ID_3 = '33333333-3333-4333-8333-333333333333';

// Mock the autocomplete cache
const mockGetCachedPersonas = vi.fn();
vi.mock('./autocompleteCache.js', () => ({
  getCachedPersonas: (...args: unknown[]) => mockGetCachedPersonas(...args),
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

function createMockPersona(overrides: Partial<PersonaSummary> = {}): PersonaSummary {
  return {
    id: PERSONA_ID_1,
    name: 'Test Persona',
    preferredName: null,
    isDefault: false,
    ...overrides,
  };
}

describe('handlePersonaAutocomplete', () => {
  const mockRespond = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRespond.mockResolvedValue(undefined);
  });

  function createMockInteraction(focusedName: string, focusedValue: string) {
    return {
      user: { id: '123456789' },
      options: {
        getFocused: vi.fn().mockReturnValue({
          name: focusedName,
          value: focusedValue,
        }),
      },
      respond: mockRespond,
    } as any;
  }

  describe('option name matching', () => {
    it('should return false for non-matching option names', async () => {
      const interaction = createMockInteraction('other-option', 'test');

      const handled = await handlePersonaAutocomplete(interaction);

      expect(handled).toBe(false);
      expect(mockRespond).not.toHaveBeenCalled();
      expect(mockGetCachedPersonas).not.toHaveBeenCalled();
    });

    it('should return true for "profile" option name by default', async () => {
      mockGetCachedPersonas.mockResolvedValue([]);

      const interaction = createMockInteraction('profile', '');
      const handled = await handlePersonaAutocomplete(interaction);

      expect(handled).toBe(true);
      expect(mockGetCachedPersonas).toHaveBeenCalled();
    });

    it('should match custom option name', async () => {
      mockGetCachedPersonas.mockResolvedValue([]);

      const interaction = createMockInteraction('persona', '');
      const handled = await handlePersonaAutocomplete(interaction, {
        optionName: 'persona',
      });

      expect(handled).toBe(true);
    });

    it('should not match non-matching custom option name', async () => {
      const interaction = createMockInteraction('profile', '');
      const handled = await handlePersonaAutocomplete(interaction, {
        optionName: 'different-option',
      });

      expect(handled).toBe(false);
      expect(mockGetCachedPersonas).not.toHaveBeenCalled();
    });
  });

  describe('cache usage', () => {
    it('should call cache with correct user ID', async () => {
      mockGetCachedPersonas.mockResolvedValue([]);

      const interaction = createMockInteraction('profile', '');
      await handlePersonaAutocomplete(interaction);

      expect(mockGetCachedPersonas).toHaveBeenCalledWith('123456789');
    });

    it('should return empty array when cache returns empty', async () => {
      mockGetCachedPersonas.mockResolvedValue([]);

      const interaction = createMockInteraction('profile', '');
      const handled = await handlePersonaAutocomplete(interaction);

      expect(handled).toBe(true);
      expect(mockRespond).toHaveBeenCalledWith([]);
    });

    it('should handle thrown errors gracefully', async () => {
      mockGetCachedPersonas.mockRejectedValue(new Error('Cache error'));

      const interaction = createMockInteraction('profile', '');
      const handled = await handlePersonaAutocomplete(interaction);

      expect(handled).toBe(true);
      expect(mockRespond).toHaveBeenCalledWith([]);
    });
  });

  describe('persona display', () => {
    it('should use preferredName when available', async () => {
      mockGetCachedPersonas.mockResolvedValue([
        createMockPersona({
          id: PERSONA_ID_1,
          name: 'Work',
          preferredName: 'Professional Me',
          isDefault: false,
        }),
      ]);

      const interaction = createMockInteraction('profile', '');
      await handlePersonaAutocomplete(interaction);

      // Uses standardized format: 🔒 (OWNED badge) + name
      expect(mockRespond).toHaveBeenCalledWith([
        { name: '🔒 Professional Me', value: PERSONA_ID_1 },
      ]);
    });

    it('should fall back to name when preferredName is null', async () => {
      mockGetCachedPersonas.mockResolvedValue([
        createMockPersona({
          id: PERSONA_ID_1,
          name: 'WorkProfile',
          preferredName: null,
          isDefault: false,
        }),
      ]);

      const interaction = createMockInteraction('profile', '');
      await handlePersonaAutocomplete(interaction);

      // Uses standardized format: 🔒 (OWNED badge) + name
      expect(mockRespond).toHaveBeenCalledWith([{ name: '🔒 WorkProfile', value: PERSONA_ID_1 }]);
    });

    it('should mark default profile with star indicator', async () => {
      mockGetCachedPersonas.mockResolvedValue([
        createMockPersona({
          id: PERSONA_ID_1,
          name: 'Default',
          preferredName: 'My Default',
          isDefault: true,
        }),
        createMockPersona({
          id: PERSONA_ID_2,
          name: 'Other',
          preferredName: null,
          isDefault: false,
        }),
      ]);

      const interaction = createMockInteraction('profile', '');
      await handlePersonaAutocomplete(interaction);

      // Uses standardized format: 🔒⭐ (OWNED + DEFAULT badges) for default, 🔒 for others
      expect(mockRespond).toHaveBeenCalledWith([
        { name: '🔒⭐ My Default', value: PERSONA_ID_1 },
        { name: '🔒 Other', value: PERSONA_ID_2 },
      ]);
    });
  });

  describe('filtering by query', () => {
    const testPersonas: PersonaSummary[] = [
      createMockPersona({
        id: PERSONA_ID_1,
        name: 'Work',
        preferredName: 'Professional Me',
        isDefault: false,
      }),
      createMockPersona({
        id: PERSONA_ID_2,
        name: 'Personal',
        preferredName: 'Casual Me',
        isDefault: false,
      }),
      createMockPersona({
        id: PERSONA_ID_3,
        name: 'Gaming',
        preferredName: null,
        isDefault: false,
      }),
    ];

    beforeEach(() => {
      mockGetCachedPersonas.mockResolvedValue(testPersonas);
    });

    it('should return all personas when query is empty', async () => {
      const interaction = createMockInteraction('profile', '');
      await handlePersonaAutocomplete(interaction);

      const calls = mockRespond.mock.calls[0][0];
      expect(calls).toHaveLength(3);
    });

    it('should filter by name match', async () => {
      const interaction = createMockInteraction('profile', 'work');
      await handlePersonaAutocomplete(interaction);

      const calls = mockRespond.mock.calls[0][0];
      expect(calls).toHaveLength(1);
      expect(calls[0].value).toBe(PERSONA_ID_1);
    });

    it('should filter by preferredName match', async () => {
      const interaction = createMockInteraction('profile', 'professional');
      await handlePersonaAutocomplete(interaction);

      const calls = mockRespond.mock.calls[0][0];
      expect(calls).toHaveLength(1);
      expect(calls[0].value).toBe(PERSONA_ID_1);
    });

    it('should be case-insensitive', async () => {
      const interaction = createMockInteraction('profile', 'GAMING');
      await handlePersonaAutocomplete(interaction);

      const calls = mockRespond.mock.calls[0][0];
      expect(calls).toHaveLength(1);
      expect(calls[0].value).toBe(PERSONA_ID_3);
    });

    it('should return empty when no matches', async () => {
      const interaction = createMockInteraction('profile', 'nonexistent');
      await handlePersonaAutocomplete(interaction);

      expect(mockRespond).toHaveBeenCalledWith([]);
    });
  });

  describe('create new option', () => {
    beforeEach(() => {
      mockGetCachedPersonas.mockResolvedValue([
        createMockPersona({
          id: PERSONA_ID_1,
          name: 'Existing',
          preferredName: null,
          isDefault: false,
        }),
      ]);
    });

    it('should include "Create new profile" option when includeCreateNew is true', async () => {
      const interaction = createMockInteraction('profile', '');
      await handlePersonaAutocomplete(interaction, { includeCreateNew: true });

      // Uses standardized format: 🔒 (OWNED badge) for existing personas
      expect(mockRespond).toHaveBeenCalledWith([
        { name: '🔒 Existing', value: PERSONA_ID_1 },
        { name: '➕ Create new profile...', value: CREATE_NEW_PERSONA_VALUE },
      ]);
    });

    it('should not include "Create new profile" when includeCreateNew is false', async () => {
      const interaction = createMockInteraction('profile', '');
      await handlePersonaAutocomplete(interaction, { includeCreateNew: false });

      const response = mockRespond.mock.calls[0][0];
      expect(response).not.toContainEqual(
        expect.objectContaining({ value: CREATE_NEW_PERSONA_VALUE })
      );
    });

    it('should filter "Create new profile" option based on query - matches "create"', async () => {
      mockGetCachedPersonas.mockResolvedValue([]);

      const interaction = createMockInteraction('profile', 'create');
      await handlePersonaAutocomplete(interaction, { includeCreateNew: true });

      expect(mockRespond).toHaveBeenCalledWith([
        { name: '➕ Create new profile...', value: CREATE_NEW_PERSONA_VALUE },
      ]);
    });

    it('should filter "Create new profile" option based on query - no match', async () => {
      mockGetCachedPersonas.mockResolvedValue([]);

      const interaction = createMockInteraction('profile', 'xyz');
      await handlePersonaAutocomplete(interaction, { includeCreateNew: true });

      expect(mockRespond).toHaveBeenCalledWith([]);
    });
  });

  describe('Discord limits', () => {
    it('should respect AUTOCOMPLETE_MAX_CHOICES limit', async () => {
      // Create 30 personas (more than the 25 limit)
      const manyPersonas = Array.from({ length: 30 }, (_, i) =>
        createMockPersona({
          id: `${i.toString().padStart(8, '0')}-0000-4000-8000-000000000000`,
          name: `Persona ${i}`,
          preferredName: null,
          isDefault: false,
        })
      );

      mockGetCachedPersonas.mockResolvedValue(manyPersonas);

      const interaction = createMockInteraction('profile', '');
      await handlePersonaAutocomplete(interaction);

      const calls = mockRespond.mock.calls[0][0];
      expect(calls.length).toBeLessThanOrEqual(25);
    });

    it('should reserve one slot for "Create new" when includeCreateNew is true', async () => {
      // Create 30 personas
      const manyPersonas = Array.from({ length: 30 }, (_, i) =>
        createMockPersona({
          id: `${i.toString().padStart(8, '0')}-0000-4000-8000-000000000000`,
          name: `Persona ${i}`,
          preferredName: null,
          isDefault: false,
        })
      );

      mockGetCachedPersonas.mockResolvedValue(manyPersonas);

      const interaction = createMockInteraction('profile', '');
      await handlePersonaAutocomplete(interaction, { includeCreateNew: true });

      const calls = mockRespond.mock.calls[0][0];
      // Should have 24 personas + 1 create new = 25 max
      expect(calls.length).toBe(25);
      expect(calls[calls.length - 1].value).toBe(CREATE_NEW_PERSONA_VALUE);
    });
  });

  describe('custom log prefix', () => {
    it('should use custom log prefix for logging', async () => {
      mockGetCachedPersonas.mockRejectedValue(new Error('Test error'));

      const interaction = createMockInteraction('profile', '');
      await handlePersonaAutocomplete(interaction, { logPrefix: '[History]' });

      // Should still handle gracefully (we can't easily test log output)
      expect(mockRespond).toHaveBeenCalledWith([]);
    });
  });
});
