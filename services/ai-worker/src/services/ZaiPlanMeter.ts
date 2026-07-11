/**
 * z.ai coding-plan usage meter — the owner-protection input for the free-tier
 * piggyback's headroom gate, and the tuning instrument behind /admin usage's
 * plan section.
 *
 * Polls z.ai's quota endpoint (first-party-used but UNDOCUMENTED — shape
 * verified by live probe against the owner's plan; treat as semi-stable and
 * fail SOFT on any drift). Auth quirk: the key goes in `Authorization` RAW,
 * no `Bearer` prefix (matches z.ai's own coding-plan plugin).
 *
 * The reading is cached in-process (~5 min) — headroom decisions need
 * minutes-level freshness, never per-request fetches — and mirrored to a
 * short-TTL Redis snapshot so api-gateway can render live meters in
 * /admin usage without ever holding the coding-plan key.
 *
 * Fail-soft contract: any fetch/shape failure returns null (logged once per
 * refresh attempt). Callers treat null as "meter unavailable — static caps
 * only": the headroom gate stays open and the daily request budget remains
 * the volume bound.
 */

import { z } from 'zod';
import type { Redis } from 'ioredis';
import { ZAI_PLAN_METER_SNAPSHOT_KEY } from '@tzurot/common-types/constants/redis-keys';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('ZaiPlanMeter');

const QUOTA_ENDPOINT = 'https://api.z.ai/api/monitor/usage/quota/limit';

/** Cache lifetime for a successful reading. */
const READING_TTL_MS = 5 * 60 * 1000;
/** Back off shorter on failure so a transient blip recovers quickly. */
const FAILURE_RETRY_MS = 60 * 1000;
/** Redis snapshot lives a bit past the cache so /admin usage sees fresh-ish data. */
const SNAPSHOT_TTL_SECONDS = 15 * 60;
/** Endpoint call budget — a hung meter must not stall admission decisions. */
const FETCH_TIMEOUT_MS = 10 * 1000;

/**
 * Probe-verified response shape (live probe against the owner's plan):
 * `data.limits[]` mixes
 * TIME_LIMIT/TOKENS_LIMIT entries; the TOKENS_LIMIT rows are the plan's usage
 * windows (observed: the 5-hour and the weekly meter), each carrying a
 * percentage-consumed integer and an epoch-ms reset time. Extra fields pass
 * through (strip mode is fine — we enumerate what we read).
 */
const QuotaLimitEntrySchema = z.object({
  type: z.string(),
  percentage: z.number(),
  nextResetTime: z.number().optional(),
});
const QuotaResponseSchema = z.object({
  data: z.object({
    limits: z.array(QuotaLimitEntrySchema),
  }),
});

export interface ZaiPlanReading {
  /** The MOST consumed usage window's percentage (0-100) — the binding one. */
  tighterWindowConsumedPct: number;
  /** That window's reset time, when the endpoint provided one. */
  resetAt: Date | null;
  /** When this reading was fetched. */
  fetchedAt: Date;
}

export class ZaiPlanMeter {
  private cached: ZaiPlanReading | null = null;
  private nextFetchAfterMs = 0;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly redis: Redis | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
    /** Injectable clock (ms) for deterministic tests; defaults to wall time. */
    private readonly now: () => number = () => Date.now()
  ) {}

  /**
   * Current plan reading, cached ~5 min. Null when the key is absent or the
   * endpoint/shape fails — callers fall back to static caps.
   */
  async getReading(): Promise<ZaiPlanReading | null> {
    const apiKey = this.apiKey;
    if (apiKey === undefined || apiKey.length === 0) {
      return null;
    }
    const nowMs = this.now();
    if (nowMs < this.nextFetchAfterMs) {
      return this.cached;
    }
    return this.refresh(nowMs, apiKey);
  }

  private async refresh(nowMs: number, apiKey: string): Promise<ZaiPlanReading | null> {
    try {
      const response = await this.fetchImpl(QUOTA_ENDPOINT, {
        // RAW key — z.ai's coding-plan endpoints reject a Bearer prefix here.
        headers: { Authorization: apiKey },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`quota endpoint returned HTTP ${response.status}`);
      }
      const parsed = QuotaResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error('quota endpoint response shape changed (semi-stable endpoint drifted)');
      }

      const windows = parsed.data.data.limits.filter(entry => entry.type === 'TOKENS_LIMIT');
      if (windows.length === 0) {
        throw new Error('quota endpoint reported no TOKENS_LIMIT windows');
      }
      const tighter = windows.reduce((a, b) => (b.percentage > a.percentage ? b : a));

      const reading: ZaiPlanReading = {
        tighterWindowConsumedPct: tighter.percentage,
        resetAt: tighter.nextResetTime !== undefined ? new Date(tighter.nextResetTime) : null,
        fetchedAt: new Date(nowMs),
      };
      this.cached = reading;
      this.nextFetchAfterMs = nowMs + READING_TTL_MS;
      await this.writeSnapshot(reading);
      return reading;
    } catch (error) {
      logger.warn(
        { err: error },
        'z.ai plan meter unavailable — headroom gate open, static caps only'
      );
      this.cached = null;
      this.nextFetchAfterMs = nowMs + FAILURE_RETRY_MS;
      return null;
    }
  }

  /** Mirror the reading for api-gateway's /admin usage (fail-soft). */
  private async writeSnapshot(reading: ZaiPlanReading): Promise<void> {
    if (this.redis === undefined) {
      return;
    }
    try {
      await this.redis.set(
        ZAI_PLAN_METER_SNAPSHOT_KEY,
        JSON.stringify({
          tighterWindowConsumedPct: reading.tighterWindowConsumedPct,
          resetAt: reading.resetAt?.toISOString() ?? null,
          fetchedAt: reading.fetchedAt.toISOString(),
        }),
        'EX',
        SNAPSHOT_TTL_SECONDS
      );
    } catch (error) {
      logger.warn({ err: error }, 'Failed to write z.ai plan meter snapshot');
    }
  }
}
