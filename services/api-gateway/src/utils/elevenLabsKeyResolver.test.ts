/**
 * Tests for ElevenLabs API Key Resolver
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveElevenLabsKey } from './elevenLabsKeyResolver.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

vi.mock('@tzurot/common-types/utils/encryption', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/encryption')>(
    '@tzurot/common-types/utils/encryption'
  );
  return {
    ...actual,
    decryptApiKey: vi.fn().mockReturnValue('decrypted-elevenlabs-key'),
  };
});

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { decryptApiKey } from '@tzurot/common-types/utils/encryption';
import { undecryptableApiKeyMessage } from '@tzurot/common-types/utils/providerDisplayName';

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

  it('returns UNAUTHORIZED with the undecryptable-key message when the stored key cannot be decrypted', async () => {
    const realEncryption = await vi.importActual<
      typeof import('@tzurot/common-types/utils/encryption')
    >('@tzurot/common-types/utils/encryption');

    const previousKey = process.env.API_KEY_ENCRYPTION_KEY;
    const previousPreviousKey = process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;
    process.env.API_KEY_ENCRYPTION_KEY = 'a'.repeat(64);
    delete process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;

    try {
      const encrypted = realEncryption.encryptApiKey(
        'TEST-FIXTURE-not-a-real-elevenlabs-api-key-abcdef'
      );

      const corruptedTag = `${encrypted.tag[0] === '0' ? '1' : '0'}${encrypted.tag.slice(1)}`;
      const corruptedKey = { ...encrypted, tag: corruptedTag };

      (mockPrisma.user.findFirst as any).mockResolvedValue({
        id: 'user-uuid',
        apiKeys: [corruptedKey],
      });
      vi.mocked(decryptApiKey).mockImplementationOnce(realEncryption.decryptApiKey);

      const result = await resolveElevenLabsKey(mockPrisma, 'discord-123');

      expect(result).toHaveProperty('errorResponse');
      if ('errorResponse' in result) {
        expect(result.errorResponse.error).toBe('UNAUTHORIZED');
        expect(result.errorResponse.message).toBe(
          undecryptableApiKeyMessage(AIProvider.ElevenLabs)
        );
      }

      // Pins that the caught failure is the GCM auth-tag mismatch (the
      // fixture's actual failure mode), not a missing-encryption-key
      // config error that would also produce a caught `unknown` here.
      const loggedFields = mockLogger.warn.mock.calls[0][0] as { err: unknown };
      expect((loggedFields.err as Error).message).toBe(
        'Unsupported state or unable to authenticate data'
      );
    } finally {
      if (previousKey === undefined) {
        delete process.env.API_KEY_ENCRYPTION_KEY;
      } else {
        process.env.API_KEY_ENCRYPTION_KEY = previousKey;
      }
      if (previousPreviousKey === undefined) {
        delete process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;
      } else {
        process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS = previousPreviousKey;
      }
    }
  });

  it('lets a decrypt failure propagate instead of returning UNAUTHORIZED when the service itself is misconfigured', async () => {
    const realEncryption = await vi.importActual<
      typeof import('@tzurot/common-types/utils/encryption')
    >('@tzurot/common-types/utils/encryption');

    const previousKey = process.env.API_KEY_ENCRYPTION_KEY;
    const previousPreviousKey = process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;
    delete process.env.API_KEY_ENCRYPTION_KEY;
    delete process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;

    try {
      (mockPrisma.user.findFirst as any).mockResolvedValue({
        id: 'user-uuid',
        apiKeys: [{ iv: 'bad-iv', content: 'bad-content', tag: 'bad-tag' }],
      });
      vi.mocked(decryptApiKey).mockImplementationOnce(realEncryption.decryptApiKey);

      await expect(resolveElevenLabsKey(mockPrisma, 'discord-123')).rejects.toThrow(
        'API_KEY_ENCRYPTION_KEY environment variable is required'
      );
      expect(mockLogger.warn).not.toHaveBeenCalled();
    } finally {
      if (previousKey === undefined) {
        delete process.env.API_KEY_ENCRYPTION_KEY;
      } else {
        process.env.API_KEY_ENCRYPTION_KEY = previousKey;
      }
      if (previousPreviousKey === undefined) {
        delete process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;
      } else {
        process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS = previousPreviousKey;
      }
    }
  });
});
