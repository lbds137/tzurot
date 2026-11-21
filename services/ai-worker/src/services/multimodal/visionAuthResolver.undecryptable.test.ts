/**
 * visionAuthResolver — wiring test for an undecryptable stored OpenRouter key.
 *
 * Unlike visionAuthResolver.test.ts this file does NOT mock the ApiKeyResolver:
 * a real resolver reads a really-encrypted row whose GCM tag was flipped, with
 * Prisma mocked only at its boundary. It pins that the broad free fallback
 * stays reachable when the user's own OpenRouter row will not decrypt, because
 * the real resolver re-throws for that user on every call (never cached).
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { AIProvider, FREE_ROUTER_MODEL } from '@tzurot/common-types/constants/ai';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { encryptApiKey } from '@tzurot/common-types/utils/encryption';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { ApiKeyResolver } from '../ApiKeyResolver.js';
import { createVisionQuotaTracker, resolveVisionAuth } from './visionAuthResolver.js';

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => ({ OPENROUTER_API_KEY: 'system-openrouter-key' }),
  };
});

vi.mock('./VisionProcessor.js', () => ({ selectVisionModel: vi.fn() }));

const mockTryConsume = vi.fn();
vi.mock('../../redis.js', () => ({
  visionFallbackQuota: { tryConsume: (...args: unknown[]) => mockTryConsume(...args) },
  zaiFreeTierAdmission: { admit: vi.fn(), systemKey: vi.fn() },
  visionDescriptionCache: {},
}));

const TEST_KEY_HEX = 'ab'.repeat(32);

/** Flip one bit of the first GCM auth-tag byte so authentication fails. */
function corruptTag(tag: string): string {
  const firstByte = parseInt(tag.slice(0, 2), 16) ^ 0x01;
  return firstByte.toString(16).padStart(2, '0') + tag.slice(2);
}

describe('resolveVisionAuth — undecryptable OpenRouter row, real ApiKeyResolver', () => {
  let findFirst: Mock;
  let resolver: ApiKeyResolver;
  const originalKey = process.env.API_KEY_ENCRYPTION_KEY;
  const originalPrevious = process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;

  beforeEach(() => {
    process.env.API_KEY_ENCRYPTION_KEY = TEST_KEY_HEX;
    delete process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;
    mockTryConsume.mockReset().mockResolvedValue(true);
    const row = encryptApiKey('sk-or-real-specimen');
    // Only the OpenRouter row exists, and it is corrupted; no z.ai row.
    findFirst = vi.fn(async (args: { where: { provider: string } }) =>
      args.where.provider === (AIProvider.OpenRouter as string)
        ? { ...row, tag: corruptTag(row.tag) }
        : null
    );
    resolver = new ApiKeyResolver({ userApiKey: { findFirst } } as unknown as PrismaClient);
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.API_KEY_ENCRYPTION_KEY;
    } else {
      process.env.API_KEY_ENCRYPTION_KEY = originalKey;
    }
    if (originalPrevious === undefined) {
      delete process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;
    } else {
      process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS = originalPrevious;
    }
  });

  it('resolves to the free vision model on the system key and consumes the quota', async () => {
    const result = await resolveVisionAuth(
      'qwen/qwen3.5-397b-a17b',
      {
        personality: {} as unknown as LoadedPersonality,
        mainProvider: AIProvider.ZaiCoding,
        mainApiKey: 'main-zai-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: resolver,
      },
      createVisionQuotaTracker('user-1'),
      true
    );

    expect(result).toEqual({
      kind: 'resolved',
      config: {
        apiKey: 'system-openrouter-key',
        provider: AIProvider.OpenRouter,
        model: FREE_ROUTER_MODEL,
        source: 'system',
        isGuestMode: false,
      },
    });
    expect(mockTryConsume).toHaveBeenCalledWith('user-1');
  });
});
