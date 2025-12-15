/**
 * Tests for persona route helpers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractString, getOrCreateInternalUser } from './helpers.js';

describe('extractString', () => {
  it('should return trimmed string for valid input', () => {
    expect(extractString('  hello  ')).toBe('hello');
    expect(extractString('test')).toBe('test');
  });

  it('should return null for empty string by default', () => {
    expect(extractString('')).toBeNull();
    expect(extractString('   ')).toBeNull();
  });

  it('should return empty string when allowEmpty is true', () => {
    expect(extractString('', true)).toBe('');
    expect(extractString('   ', true)).toBe('');
  });

  it('should return null for non-string values', () => {
    expect(extractString(null)).toBeNull();
    expect(extractString(undefined)).toBeNull();
    expect(extractString(123)).toBeNull();
    expect(extractString({})).toBeNull();
    expect(extractString([])).toBeNull();
  });
});

describe('getOrCreateInternalUser', () => {
  const mockPrisma = {
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return existing user if found', async () => {
    const existingUser = { id: 'user-123', defaultPersonaId: 'persona-456' };
    mockPrisma.user.findFirst.mockResolvedValue(existingUser);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getOrCreateInternalUser(mockPrisma as any, 'discord-123');

    expect(result).toEqual(existingUser);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('should create new user if not found', async () => {
    const newUser = { id: 'new-user-123', defaultPersonaId: null };
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue(newUser);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getOrCreateInternalUser(mockPrisma as any, 'discord-456');

    expect(result).toEqual(newUser);
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        discordId: 'discord-456',
        username: 'discord-456',
      },
      select: { id: true, defaultPersonaId: true },
    });
  });
});
