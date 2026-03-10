/**
 * Tests for ElevenLabs API Key Resolver
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveElevenLabsKey } from './elevenLabsKeyResolver.js';
import type { PrismaClient } from '@tzurot/common-types';

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    decryptApiKey: vi.fn().mockReturnValue('decrypted-elevenlabs-key'),
  };
});

import { decryptApiKey } from '@tzurot/common-types';

describe('resolveElevenLabsKey', () => {
  const mockPrisma = {
    user: {
      findFirst: vi.fn(),
    },
  } as unknown as PrismaClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(decryptApiKey).mockReturnValue('decrypted-elevenlabs-key');
  });

  it('should return decrypted API key when user has an ElevenLabs key', async () => {
    (mockPrisma.user.findFirst as any).mockResolvedValue({
      id: 'user-uuid',
      apiKeys: [{ iv: 'test-iv', content: 'test-content', tag: 'test-tag' }],
    });

    const result = await resolveElevenLabsKey(mockPrisma, 'discord-123');

    expect(result).toEqual({ apiKey: 'decrypted-elevenlabs-key' });
    expect(decryptApiKey).toHaveBeenCalledWith({
      iv: 'test-iv',
      content: 'test-content',
      tag: 'test-tag',
    });
  });

  it('should return NOT_FOUND when user does not exist', async () => {
    (mockPrisma.user.findFirst as any).mockResolvedValue(null);

    const result = await resolveElevenLabsKey(mockPrisma, 'discord-unknown');

    expect(result).toHaveProperty('errorResponse');
    if ('errorResponse' in result) {
      expect(result.errorResponse.error).toBe('NOT_FOUND');
    }
  });

  it('should return NOT_FOUND when user has no ElevenLabs key', async () => {
    (mockPrisma.user.findFirst as any).mockResolvedValue({
      id: 'user-uuid',
      apiKeys: [],
    });

    const result = await resolveElevenLabsKey(mockPrisma, 'discord-123');

    expect(result).toHaveProperty('errorResponse');
    if ('errorResponse' in result) {
      expect(result.errorResponse.error).toBe('NOT_FOUND');
      expect(result.errorResponse.message).toContain('ElevenLabs API key');
    }
  });

  it('should return INTERNAL_ERROR when decryption fails', async () => {
    (mockPrisma.user.findFirst as any).mockResolvedValue({
      id: 'user-uuid',
      apiKeys: [{ iv: 'bad-iv', content: 'bad-content', tag: 'bad-tag' }],
    });
    vi.mocked(decryptApiKey).mockImplementation(() => {
      throw new Error('Decryption failed');
    });

    const result = await resolveElevenLabsKey(mockPrisma, 'discord-123');

    expect(result).toHaveProperty('errorResponse');
    if ('errorResponse' in result) {
      expect(result.errorResponse.error).toBe('INTERNAL_ERROR');
    }
  });
});
