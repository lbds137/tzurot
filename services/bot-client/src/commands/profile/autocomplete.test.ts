/**
 * Tests for Profile Command Autocomplete Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePersonalityAutocomplete, handlePersonaAutocomplete, CREATE_NEW_PERSONA_VALUE } from './autocomplete.js';

// Mock Prisma
const mockPrismaClient = {
  personality: {
    findMany: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
};

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    getPrismaClient: vi.fn(() => mockPrismaClient),
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

  it('should return empty array for non-personality focused option', async () => {
    await handlePersonalityAutocomplete(createMockInteraction('other-field', 'test'));

    expect(mockRespond).toHaveBeenCalledWith([]);
    expect(mockPrismaClient.personality.findMany).not.toHaveBeenCalled();
  });

  it('should return matching personalities', async () => {
    mockPrismaClient.personality.findMany.mockResolvedValue([
      { slug: 'lilith', name: 'Lilith', displayName: 'Lilith the Succubus' },
      { slug: 'luna', name: 'Luna', displayName: null },
    ]);

    await handlePersonalityAutocomplete(createMockInteraction('personality', 'li'));

    expect(mockPrismaClient.personality.findMany).toHaveBeenCalledWith({
      where: {
        isPublic: true,
        OR: [
          { name: { contains: 'li', mode: 'insensitive' } },
          { displayName: { contains: 'li', mode: 'insensitive' } },
          { slug: { contains: 'li', mode: 'insensitive' } },
        ],
      },
      select: {
        slug: true,
        name: true,
        displayName: true,
      },
      orderBy: { name: 'asc' },
      take: 25, // DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES
    });

    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'Lilith the Succubus', value: 'lilith' },
      { name: 'Luna', value: 'luna' },
    ]);
  });

  it('should use name as fallback when displayName is null', async () => {
    mockPrismaClient.personality.findMany.mockResolvedValue([
      { slug: 'bot', name: 'TestBot', displayName: null },
    ]);

    await handlePersonalityAutocomplete(createMockInteraction('personality', 'test'));

    expect(mockRespond).toHaveBeenCalledWith([{ name: 'TestBot', value: 'bot' }]);
  });

  it('should return empty array when no personalities match', async () => {
    mockPrismaClient.personality.findMany.mockResolvedValue([]);

    await handlePersonalityAutocomplete(createMockInteraction('personality', 'xyz'));

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should lowercase the query for case-insensitive search', async () => {
    mockPrismaClient.personality.findMany.mockResolvedValue([]);

    await handlePersonalityAutocomplete(createMockInteraction('personality', 'UPPER'));

    expect(mockPrismaClient.personality.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ name: { contains: 'upper', mode: 'insensitive' } }]),
        }),
      })
    );
  });

  it('should handle database errors gracefully', async () => {
    mockPrismaClient.personality.findMany.mockRejectedValue(new Error('DB error'));

    await handlePersonalityAutocomplete(createMockInteraction('personality', 'test'));

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should handle empty query string', async () => {
    mockPrismaClient.personality.findMany.mockResolvedValue([
      { slug: 'default', name: 'Default', displayName: 'Default Bot' },
    ]);

    await handlePersonalityAutocomplete(createMockInteraction('personality', ''));

    expect(mockPrismaClient.personality.findMany).toHaveBeenCalled();
    expect(mockRespond).toHaveBeenCalledWith([{ name: 'Default Bot', value: 'default' }]);
  });
});

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

  it('should return empty array for non-profile focused option', async () => {
    await handlePersonaAutocomplete(createMockInteraction('other-field', 'test'));

    expect(mockRespond).toHaveBeenCalledWith([]);
    expect(mockPrismaClient.user.findUnique).not.toHaveBeenCalled();
  });

  it('should return user profiles with preferredName as display', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersonaId: null,
      ownedPersonas: [
        { id: 'persona-1', name: 'Work', preferredName: 'Professional Me' },
        { id: 'persona-2', name: 'Casual', preferredName: 'Relaxed Me' },
      ],
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'Professional Me', value: 'persona-1' },
      { name: 'Relaxed Me', value: 'persona-2' },
    ]);
  });

  it('should mark default profile with star indicator', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersonaId: 'persona-1',
      ownedPersonas: [
        { id: 'persona-1', name: 'Default', preferredName: 'My Default' },
        { id: 'persona-2', name: 'Other', preferredName: null },
      ],
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'My Default ⭐ (default)', value: 'persona-1' },
      { name: 'Other', value: 'persona-2' },
    ]);
  });

  it('should use name as fallback when preferredName is null', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersonaId: null,
      ownedPersonas: [{ id: 'persona-1', name: 'WorkProfile', preferredName: null }],
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''));

    expect(mockRespond).toHaveBeenCalledWith([{ name: 'WorkProfile', value: 'persona-1' }]);
  });

  it('should include "Create new profile" option when includeCreateNew is true', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersonaId: null,
      ownedPersonas: [{ id: 'persona-1', name: 'Existing', preferredName: null }],
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''), true);

    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'Existing', value: 'persona-1' },
      { name: '➕ Create new profile...', value: CREATE_NEW_PERSONA_VALUE },
    ]);
  });

  it('should not include "Create new profile" when includeCreateNew is false', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersonaId: null,
      ownedPersonas: [{ id: 'persona-1', name: 'Existing', preferredName: null }],
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''), false);

    const response = mockRespond.mock.calls[0][0];
    expect(response).not.toContainEqual(
      expect.objectContaining({ value: CREATE_NEW_PERSONA_VALUE })
    );
  });

  it('should filter "Create new profile" option based on query', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersonaId: null,
      ownedPersonas: [],
    });

    // Query matches "create"
    await handlePersonaAutocomplete(createMockInteraction('profile', 'create'), true);
    expect(mockRespond).toHaveBeenCalledWith([
      { name: '➕ Create new profile...', value: CREATE_NEW_PERSONA_VALUE },
    ]);

    vi.clearAllMocks();

    // Query doesn't match
    await handlePersonaAutocomplete(createMockInteraction('profile', 'xyz'), true);
    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should return empty array when user has no profiles', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersonaId: null,
      ownedPersonas: [],
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''));

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should return empty array when user not found', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue(null);

    await handlePersonaAutocomplete(createMockInteraction('profile', ''));

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should handle database errors gracefully', async () => {
    mockPrismaClient.user.findUnique.mockRejectedValue(new Error('DB error'));

    await handlePersonaAutocomplete(createMockInteraction('profile', 'test'));

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should filter profiles based on query', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersonaId: null,
      ownedPersonas: [{ id: 'persona-1', name: 'Work', preferredName: 'Professional' }],
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', 'work'));

    // Query is passed to Prisma, verify the call includes the filter
    expect(mockPrismaClient.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          ownedPersonas: expect.objectContaining({
            where: {
              OR: [
                { name: { contains: 'work', mode: 'insensitive' } },
                { preferredName: { contains: 'work', mode: 'insensitive' } },
              ],
            },
          }),
        }),
      })
    );
  });

  it('should not filter when query is empty', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersonaId: null,
      ownedPersonas: [],
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''));

    expect(mockPrismaClient.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          ownedPersonas: expect.objectContaining({
            where: undefined,
          }),
        }),
      })
    );
  });

  it('should limit results to leave room for Create option when includeCreateNew is true', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersonaId: null,
      ownedPersonas: [],
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''), true);

    expect(mockPrismaClient.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          ownedPersonas: expect.objectContaining({
            take: 24, // DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES - 1
          }),
        }),
      })
    );
  });

  it('should use full limit when includeCreateNew is false', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersonaId: null,
      ownedPersonas: [],
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''), false);

    expect(mockPrismaClient.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          ownedPersonas: expect.objectContaining({
            take: 25, // DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES
          }),
        }),
      })
    );
  });
});
