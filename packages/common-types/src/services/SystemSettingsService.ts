/**
 * SystemSettingsService — the read path for owner-only operational settings
 * (`admin_settings.system_settings` JSONB).
 *
 * Hot-path contract (design D4, docs/proposals/backlog/admin-runtime-settings.md):
 * `get()` is a SYNCHRONOUS in-memory read — never a per-call DB hit, never
 * throws, never blocks. Refresh is stale-while-revalidate: on TTL expiry or
 * invalidation the stale value keeps serving while ONE async refresh runs
 * (single-flight); on DB failure the service serves the last-known value, else
 * the registry's in-code fallback constant — the floor beneath the floor.
 *
 * Per-key validation: one corrupted key must not discard the rest of the bag,
 * so each key is validated independently against its schema field; invalid
 * keys are dropped (warn) and served from the fallback constant.
 */

import { INTERVALS } from '../constants/timing.js';
import { ADMIN_SETTINGS_SINGLETON_ID } from '../schemas/api/adminSettings.js';
import {
  SYSTEM_SETTINGS_FALLBACKS,
  SYSTEM_SETTINGS_KEYS,
  SystemSettingsSchema,
  type SystemSettings,
} from '../schemas/api/systemSettings.js';
import { createLogger } from '../utils/logger.js';
import type { PrismaClient } from '../generated/prisma/client.js';

const logger = createLogger('SystemSettingsService');

export class SystemSettingsService {
  private values: Partial<SystemSettings> = {};
  private fetchedAt = 0;
  private refreshInFlight: Promise<void> | null = null;
  private hasLoadedOnce = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ttlMs: number = INTERVALS.API_KEY_CACHE_TTL
  ) {}

  /**
   * Synchronous read. Serves the cached value, kicking a background refresh
   * when stale; absent/invalid keys serve the registry fallback constant.
   */
  get<K extends keyof SystemSettings>(key: K): SystemSettings[K] {
    this.kickRefreshIfStale();
    return this.values[key] ?? SYSTEM_SETTINGS_FALLBACKS[key];
  }

  /**
   * Mark the cache stale and kick a refresh now (invalidation-event handler).
   * The stale bag keeps serving until the refresh lands — never a gap.
   */
  invalidate(): void {
    this.fetchedAt = 0;
    this.kickRefreshIfStale();
  }

  /**
   * Await one refresh — boot priming, so first requests see DB values instead
   * of fallback constants. `refresh()` swallows its own errors (boot must not
   * die on a settings read; the fallbacks are the designed degraded mode).
   */
  async prime(): Promise<void> {
    await this.refresh();
  }

  /** True once any refresh has successfully loaded the row (observability). */
  isLoaded(): boolean {
    return this.hasLoadedOnce;
  }

  private kickRefreshIfStale(): void {
    const stale = Date.now() - this.fetchedAt >= this.ttlMs;
    if (!stale || this.refreshInFlight !== null) {
      return;
    }
    this.refreshInFlight = this.refresh()
      .catch(() => undefined)
      .finally(() => {
        this.refreshInFlight = null;
      });
  }

  private async refresh(): Promise<void> {
    try {
      const row = await this.prisma.adminSettings.findUnique({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        select: { systemSettings: true },
      });
      this.values = pickValidKeys(row?.systemSettings ?? null);
      this.hasLoadedOnce = true;
    } catch (error) {
      logger.warn(
        { err: error },
        'System-settings refresh failed — serving last-known values (or fallbacks)'
      );
    } finally {
      // Stamp even on failure: retry cadence is the TTL, not a hot loop.
      this.fetchedAt = Date.now();
    }
  }
}

/**
 * Validate each known key independently against its schema field. Unknown keys
 * are ignored here (read path) — preservation of unknown keys is the WRITE
 * path's contract, enforced in the gateway merge.
 */
function pickValidKeys(raw: unknown): Partial<SystemSettings> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const bag = raw as Record<string, unknown>;
  const result: Partial<SystemSettings> = {};
  for (const key of SYSTEM_SETTINGS_KEYS) {
    if (!(key in bag)) {
      continue;
    }
    const parsed = SystemSettingsSchema.shape[key].safeParse(bag[key]);
    if (parsed.success) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- per-key dynamic assignment over a schema-derived key union; the safeParse above guarantees the value matches the key's field type
      (result as any)[key] = parsed.data;
    } else {
      logger.warn({ key }, 'Dropping invalid system-settings key — serving its fallback');
    }
  }
  return result;
}
