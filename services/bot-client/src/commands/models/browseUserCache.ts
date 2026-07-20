/**
 * Short-lived caches for `/models browse` user context.
 *
 * Browse reads two user-scoped things on EVERY interaction (initial render, page
 * flip, filter change, search): the caller's active key providers (for the
 * ✅/🔒/❔ usability marker) and the set of models used by global presets (for
 * the 🌐 global-preset pin). Neither changes meaningfully during a browse session, so a short
 * TTL cache avoids re-hitting the gateway on every button press. Mirrors the
 * single-key TTLCache pattern in `preset/autocomplete.ts`.
 *
 * TTL is deliberately short (30s, not the 5-min `TIMEOUTS.CACHE_TTL`): a user
 * who just ran `/settings apikey set` should see updated usability within a page
 * flip or two, not minutes later.
 */

import { TTLCache } from '@tzurot/common-types/utils/TTLCache';
import type { UserClient } from '@tzurot/clients';

/** Browse caches refresh within ~a page flip or two of a key/preset change. */
const BROWSE_CACHE_TTL_MS = 30_000;

const GLOBAL_PRESETS_KEY = 'global-presets';

// Global presets are user-INDEPENDENT (the same `isGlobal` rows for everyone),
// so a single shared entry serves all users.
let globalPresetCache: TTLCache<ReadonlySet<string>> | null = null;
function presetCache(): TTLCache<ReadonlySet<string>> {
  globalPresetCache ??= new TTLCache<ReadonlySet<string>>({ ttl: BROWSE_CACHE_TTL_MS, maxSize: 1 });
  return globalPresetCache;
}

// Wallet providers are PER-USER, so the cache is keyed by user id (LRU-bounded).
let walletProviderCache: TTLCache<ReadonlySet<string>> | null = null;
function providerCache(): TTLCache<ReadonlySet<string>> {
  walletProviderCache ??= new TTLCache<ReadonlySet<string>>({
    ttl: BROWSE_CACHE_TTL_MS,
    maxSize: 100,
  });
  return walletProviderCache;
}

/**
 * Lowercased model ids used by any global preset (drives the 🌐 global-preset pin). Returns an
 * empty set — and does NOT cache — on fetch failure, so a transient error
 * doesn't suppress pinning for the whole TTL window.
 *
 * Cross-user trust assumption: the single shared cache entry is seeded by
 * whichever user calls first, which is SAFE only because `listUserLlmConfigs`
 * returns the same `isGlobal` rows to every authenticated caller (we filter to
 * those). If that endpoint ever scoped globals by caller identity, this cache
 * would leak one user's view to others for the TTL window.
 */
export async function getGlobalPresetModelIds(
  userClient: UserClient
): Promise<ReadonlySet<string>> {
  const cached = presetCache().get(GLOBAL_PRESETS_KEY);
  if (cached !== null) {
    return cached;
  }
  const result = await userClient.listUserLlmConfigs();
  if (!result.ok) {
    return new Set();
  }
  const ids = new Set(result.data.configs.filter(c => c.isGlobal).map(c => c.model.toLowerCase()));
  presetCache().set(GLOBAL_PRESETS_KEY, ids);
  return ids;
}

/**
 * The caller's active key providers, or `null` if the wallet fetch failed
 * (= "couldn't determine keys"; the browse/card path renders this as ❔ rather
 * than a false 🔒). Failures are NOT cached so the next interaction retries.
 */
export async function getActiveProviders(
  userClient: UserClient,
  userId: string
): Promise<ReadonlySet<string> | null> {
  const cached = providerCache().get(userId);
  if (cached !== null) {
    return cached;
  }
  const result = await userClient.listWalletKeys();
  if (!result.ok) {
    return null;
  }
  const providers = new Set(result.data.keys.filter(k => k.isActive).map(k => k.provider));
  providerCache().set(userId, providers);
  return providers;
}

/**
 * Reset both caches. Test-only — lets each test exercise the cold-fetch path
 * without ordering dependencies on a prior test's populated cache.
 */
export function __resetBrowseUserCachesForTests(): void {
  globalPresetCache = null;
  walletProviderCache = null;
}
