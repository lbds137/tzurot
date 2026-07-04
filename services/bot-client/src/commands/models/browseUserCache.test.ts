/**
 * Tests for the /models browse user-context caches.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserClient } from '@tzurot/clients';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { makeOk, makeErr } from '../../test/gatewayClientStubs.js';
import { mockListWalletKeysResponse, mockListLlmConfigsResponse } from '@tzurot/test-factories';
import {
  getGlobalPresetModelIds,
  getActiveProviders,
  __resetBrowseUserCachesForTests,
} from './browseUserCache.js';

const stub = {
  listUserLlmConfigs: vi.fn(),
  listWalletKeys: vi.fn(),
};
const client = stub as unknown as UserClient;

beforeEach(() => {
  vi.clearAllMocks();
  __resetBrowseUserCachesForTests();
});

describe('getGlobalPresetModelIds', () => {
  it('returns lowercased model ids of global presets only', async () => {
    stub.listUserLlmConfigs.mockResolvedValue(
      makeOk(
        mockListLlmConfigsResponse([
          { model: 'Anthropic/Claude-Sonnet-4', isGlobal: true },
          { model: 'owned/model', isGlobal: false },
        ])
      )
    );
    const ids = await getGlobalPresetModelIds(client);
    expect(ids.has('anthropic/claude-sonnet-4')).toBe(true);
    expect(ids.has('owned/model')).toBe(false);
  });

  it('caches the result (second call does not re-fetch)', async () => {
    stub.listUserLlmConfigs.mockResolvedValue(makeOk(mockListLlmConfigsResponse([])));
    await getGlobalPresetModelIds(client);
    await getGlobalPresetModelIds(client);
    expect(stub.listUserLlmConfigs).toHaveBeenCalledTimes(1);
  });

  it('returns an empty set and does NOT cache on failure', async () => {
    stub.listUserLlmConfigs.mockResolvedValue(makeErr(500, 'boom'));
    const ids = await getGlobalPresetModelIds(client);
    expect(ids.size).toBe(0);
    // Next call retries (failure not cached).
    stub.listUserLlmConfigs.mockResolvedValue(
      makeOk(mockListLlmConfigsResponse([{ model: 'g/m', isGlobal: true }]))
    );
    const retried = await getGlobalPresetModelIds(client);
    expect(retried.has('g/m')).toBe(true);
    expect(stub.listUserLlmConfigs).toHaveBeenCalledTimes(2);
  });
});

describe('getActiveProviders', () => {
  it('returns the set of active providers', async () => {
    stub.listWalletKeys.mockResolvedValue(
      makeOk(
        mockListWalletKeysResponse([
          { provider: AIProvider.OpenRouter, isActive: true },
          { provider: AIProvider.ZaiCoding, isActive: false },
        ])
      )
    );
    const providers = await getActiveProviders(client, 'user-1');
    expect(providers).not.toBeNull();
    expect(providers?.has('openrouter')).toBe(true);
    expect(providers?.has('zai-coding')).toBe(false); // inactive excluded
  });

  it('caches per user (second call for same user does not re-fetch)', async () => {
    stub.listWalletKeys.mockResolvedValue(makeOk(mockListWalletKeysResponse([])));
    await getActiveProviders(client, 'user-1');
    await getActiveProviders(client, 'user-1');
    expect(stub.listWalletKeys).toHaveBeenCalledTimes(1);
    // A different user is a cache miss → re-fetches.
    await getActiveProviders(client, 'user-2');
    expect(stub.listWalletKeys).toHaveBeenCalledTimes(2);
  });

  it('returns null (and does NOT cache) on failure', async () => {
    stub.listWalletKeys.mockResolvedValue(makeErr(429, 'rate limited'));
    expect(await getActiveProviders(client, 'user-1')).toBeNull();
    // Retries on next call (failure not cached).
    stub.listWalletKeys.mockResolvedValue(
      makeOk(mockListWalletKeysResponse([{ provider: AIProvider.OpenRouter, isActive: true }]))
    );
    const providers = await getActiveProviders(client, 'user-1');
    expect(providers?.has('openrouter')).toBe(true);
    expect(stub.listWalletKeys).toHaveBeenCalledTimes(2);
  });
});
