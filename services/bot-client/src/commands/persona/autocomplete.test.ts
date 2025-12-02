/**
 * Tests for Persona Autocomplete Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePersonalityAutocomplete } from './autocomplete.js';

// Mock Prisma
const mockPrismaClient = {
  personality: {
    findMany: vi.fn(),
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
