/**
 * ApiKeyResolver — undecryptable stored key vs. misconfigured encryption.
 *
 * Unlike ApiKeyResolver.test.ts this file does NOT mock `decryptApiKey`: the
 * stored row is encrypted for real and then corrupted, so the assertions pin
 * what a genuinely bad GCM auth tag does end to end.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { encryptApiKey } from '@tzurot/common-types/utils/encryption';
import { undecryptableApiKeyMessage } from '@tzurot/common-types/utils/providerDisplayName';
import {
  ApiKeyResolver,
  EncryptionMisconfiguredError,
  UndecryptableApiKeyError,
} from './ApiKeyResolver.js';
import { snapshotEncryptionEnv } from './test-utils.js';

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => ({ OPENROUTER_API_KEY: 'system-openrouter-key' }),
  };
});

const TEST_KEY_HEX = 'ab'.repeat(32);

/** Flip one bit of the first GCM auth-tag byte so authentication fails. */
function corruptTag(tag: string): string {
  const firstByte = parseInt(tag.slice(0, 2), 16) ^ 0x01;
  return firstByte.toString(16).padStart(2, '0') + tag.slice(2);
}

describe('ApiKeyResolver — undecryptable stored key', () => {
  let findFirst: Mock;
  let resolver: ApiKeyResolver;
  const restoreEncryptionEnv = snapshotEncryptionEnv();

  beforeEach(() => {
    process.env.API_KEY_ENCRYPTION_KEY = TEST_KEY_HEX;
    delete process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;
    findFirst = vi.fn();
    resolver = new ApiKeyResolver({ userApiKey: { findFirst } } as unknown as PrismaClient);
  });

  afterEach(restoreEncryptionEnv);

  function storeCorruptedRow(): void {
    const row = encryptApiKey('sk-or-real-specimen');
    findFirst.mockResolvedValue({ ...row, tag: corruptTag(row.tag) });
  }

  it('sanity: the same specimen decrypts to the user key before corruption', async () => {
    findFirst.mockResolvedValue(encryptApiKey('sk-or-real-specimen'));

    const result = await resolver.resolveApiKey('user-1', AIProvider.OpenRouter);

    expect(result).toMatchObject({ apiKey: 'sk-or-real-specimen', source: 'user' });
  });

  it('rejects with the re-enter copy (not a guest result) for a corrupted GCM tag', async () => {
    storeCorruptedRow();

    const attempt = resolver.resolveApiKey('user-1', AIProvider.OpenRouter);

    await expect(attempt).rejects.toThrow(undecryptableApiKeyMessage(AIProvider.OpenRouter));
    await expect(attempt).rejects.toBeInstanceOf(UndecryptableApiKeyError);
  });

  it('names the provider the unreadable key belongs to', async () => {
    storeCorruptedRow();

    await expect(resolver.tryResolveUserKey('user-1', AIProvider.ZaiCoding)).rejects.toThrow(
      undecryptableApiKeyMessage(AIProvider.ZaiCoding)
    );
  });

  it('caches nothing on a decrypt failure: a second resolve re-reads the row', async () => {
    storeCorruptedRow();

    await expect(resolver.resolveApiKey('user-1', AIProvider.OpenRouter)).rejects.toThrow(
      /can't be read anymore/
    );
    await expect(resolver.resolveApiKey('user-1', AIProvider.OpenRouter)).rejects.toThrow(
      /can't be read anymore/
    );

    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('recovers once the user re-enters a readable key (no stale guest entry)', async () => {
    storeCorruptedRow();
    await expect(resolver.resolveApiKey('user-1', AIProvider.OpenRouter)).rejects.toThrow(
      /can't be read anymore/
    );

    findFirst.mockResolvedValue(encryptApiKey('sk-or-fresh'));
    const result = await resolver.resolveApiKey('user-1', AIProvider.OpenRouter);

    expect(result).toMatchObject({ apiKey: 'sk-or-fresh', source: 'user', isGuestMode: false });
  });

  it('rethrows the raw error loudly when the encryption env is unset but the resolver holds a key, and caches nothing', async () => {
    // Row encrypted while configured, then the deploy loses its key.
    const row = encryptApiKey('sk-or-real-specimen');
    findFirst.mockResolvedValue(row);
    delete process.env.API_KEY_ENCRYPTION_KEY;

    const attempt = resolver.resolveApiKey('user-1', AIProvider.OpenRouter);

    await expect(attempt).rejects.toThrow(/API_KEY_ENCRYPTION_KEY/);
    await expect(attempt).rejects.not.toBeInstanceOf(UndecryptableApiKeyError);
    await expect(attempt).rejects.toBeInstanceOf(EncryptionMisconfiguredError);
    await expect(resolver.resolveApiKey('user-1', AIProvider.OpenRouter)).rejects.toThrow(
      /API_KEY_ENCRYPTION_KEY/
    );
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('rethrows loudly for a malformed (not just missing) encryption key', async () => {
    findFirst.mockResolvedValue(encryptApiKey('sk-or-real-specimen'));
    process.env.API_KEY_ENCRYPTION_KEY = 'too-short';

    const attempt = resolver.tryResolveUserKey('user-1', AIProvider.OpenRouter);

    await expect(attempt).rejects.toThrow(/must be 64 hex characters/);
    await expect(attempt).rejects.not.toBeInstanceOf(UndecryptableApiKeyError);
    await expect(attempt).rejects.toBeInstanceOf(EncryptionMisconfiguredError);
  });

  it('keeps the guest fallback when the Prisma read fails (unchanged behaviour)', async () => {
    findFirst.mockRejectedValue(new Error('connection reset'));

    const result = await resolver.resolveApiKey('user-1', AIProvider.OpenRouter);

    expect(result).toMatchObject({
      apiKey: 'system-openrouter-key',
      source: 'system',
      isGuestMode: true,
    });
  });
});

describe('ApiKeyResolver — env has no encryption key', () => {
  let findFirst: Mock;
  let resolver: ApiKeyResolver;
  let row: ReturnType<typeof encryptApiKey>;
  const restoreEncryptionEnv = snapshotEncryptionEnv();

  beforeEach(() => {
    // Encrypt a real row while configured, then lose the key (the lost-variable deploy).
    process.env.API_KEY_ENCRYPTION_KEY = TEST_KEY_HEX;
    delete process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;
    row = encryptApiKey('sk-or-real-specimen');
    delete process.env.API_KEY_ENCRYPTION_KEY;
    findFirst = vi.fn();
    resolver = new ApiKeyResolver({ userApiKey: { findFirst } } as unknown as PrismaClient);
  });

  afterEach(restoreEncryptionEnv);

  it('resolveApiKey rejects with EncryptionMisconfiguredError for an existing row, and a second call re-reads the DB', async () => {
    findFirst.mockResolvedValue(row);

    await expect(resolver.resolveApiKey('user-1', AIProvider.OpenRouter)).rejects.toBeInstanceOf(
      EncryptionMisconfiguredError
    );
    await expect(resolver.resolveApiKey('user-1', AIProvider.OpenRouter)).rejects.toBeInstanceOf(
      EncryptionMisconfiguredError
    );

    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(findFirst).toHaveBeenCalledWith({
      where: { user: { discordId: 'user-1' }, provider: AIProvider.OpenRouter, isActive: true },
      select: { iv: true, content: true, tag: true },
    });
  });

  it('resolveApiKey returns the guest result when the user has no row', async () => {
    findFirst.mockResolvedValue(null);

    const result = await resolver.resolveApiKey('user-1', AIProvider.OpenRouter);

    expect(result).toMatchObject({
      apiKey: 'system-openrouter-key',
      source: 'system',
      isGuestMode: true,
    });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('tryResolveUserKey rejects with EncryptionMisconfiguredError for an existing row, and a second call re-reads the DB', async () => {
    findFirst.mockResolvedValue(row);

    await expect(resolver.tryResolveUserKey('user-1', AIProvider.ZaiCoding)).rejects.toBeInstanceOf(
      EncryptionMisconfiguredError
    );
    await expect(resolver.tryResolveUserKey('user-1', AIProvider.ZaiCoding)).rejects.toBeInstanceOf(
      EncryptionMisconfiguredError
    );

    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('tryResolveUserKey returns null when the user has no row', async () => {
    findFirst.mockResolvedValue(null);

    await expect(resolver.tryResolveUserKey('user-1', AIProvider.ZaiCoding)).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
