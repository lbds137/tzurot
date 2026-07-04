import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveAudioProviderKeys } from './audioProviderKeyResolver.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

vi.mock('@tzurot/common-types/utils/encryption', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/encryption')>(
    '@tzurot/common-types/utils/encryption'
  );
  return {
    ...actual,
    decryptApiKey: vi.fn().mockImplementation(({ content }: { content: string }) => {
      if (content === 'el-content') return 'sk_el_decrypted';
      if (content === 'mi-content') return 'mi_decrypted';
      throw new Error(`unknown content: ${content}`);
    }),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { decryptApiKey } from '@tzurot/common-types/utils/encryption';

describe('resolveAudioProviderKeys', () => {
  const mockFindFirst = vi.fn();
  const mockPrisma = {
    user: { findFirst: mockFindFirst },
  } as unknown as PrismaClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(decryptApiKey).mockImplementation(({ content }: { content: string }) => {
      if (content === 'el-content') return 'sk_el_decrypted';
      if (content === 'mi-content') return 'mi_decrypted';
      throw new Error(`unknown content: ${content}`);
    });
  });

  it('returns ErrorResponse with NOT_FOUND when user does not exist', async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await resolveAudioProviderKeys(mockPrisma, 'discord-user-1');

    expect('errorResponse' in result).toBe(true);
    if ('errorResponse' in result) {
      expect(result.errorResponse.error).toBe('NOT_FOUND');
    }
  });

  it('returns empty Map when user exists but has no audio keys', async () => {
    mockFindFirst.mockResolvedValue({ id: 'u1', apiKeys: [] });

    const result = await resolveAudioProviderKeys(mockPrisma, 'discord-user-1');

    expect('keys' in result).toBe(true);
    if ('keys' in result) {
      expect(result.keys.size).toBe(0);
    }
  });

  it('decrypts and returns ElevenLabs key when only that one is set', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'u1',
      apiKeys: [
        { provider: AIProvider.ElevenLabs, iv: 'el-iv', content: 'el-content', tag: 'el-tag' },
      ],
    });

    const result = await resolveAudioProviderKeys(mockPrisma, 'discord-user-1');

    expect('keys' in result).toBe(true);
    if ('keys' in result) {
      expect(result.keys.get('elevenlabs')).toBe('sk_el_decrypted');
      expect(result.keys.has('mistral')).toBe(false);
    }
  });

  it('returns BOTH keys when both are configured', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'u1',
      apiKeys: [
        { provider: AIProvider.ElevenLabs, iv: 'el-iv', content: 'el-content', tag: 'el-tag' },
        { provider: AIProvider.Mistral, iv: 'mi-iv', content: 'mi-content', tag: 'mi-tag' },
      ],
    });

    const result = await resolveAudioProviderKeys(mockPrisma, 'discord-user-1');

    expect('keys' in result).toBe(true);
    if ('keys' in result) {
      expect(result.keys.get('elevenlabs')).toBe('sk_el_decrypted');
      expect(result.keys.get('mistral')).toBe('mi_decrypted');
      expect(result.keys.size).toBe(2);
    }
  });

  it('skips a provider whose decryption throws (logs and continues)', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'u1',
      apiKeys: [
        { provider: AIProvider.ElevenLabs, iv: 'el-iv', content: 'el-content', tag: 'el-tag' },
        { provider: AIProvider.Mistral, iv: 'mi-iv', content: 'corrupt-content', tag: 'mi-tag' },
      ],
    });

    const result = await resolveAudioProviderKeys(mockPrisma, 'discord-user-1');

    expect('keys' in result).toBe(true);
    if ('keys' in result) {
      // ElevenLabs decrypted fine; Mistral threw and got skipped silently
      expect(result.keys.get('elevenlabs')).toBe('sk_el_decrypted');
      expect(result.keys.has('mistral')).toBe(false);
    }
  });
});
