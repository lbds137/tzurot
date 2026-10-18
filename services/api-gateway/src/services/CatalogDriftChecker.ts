/**
 * CatalogDriftChecker — proactive detection of configured models that left
 * the OpenRouter catalog.
 *
 * OpenRouter delisting a configured model id (observed with
 * qwen/qwen3.8-27b:free, then the admin free default) makes every turn that
 * resolves to it 404 and fall to the fallback chain, silently, until a guest
 * happens to hit it. Catalog validation runs only at config write time
 * (llmConfigValidation), never again — this check closes that gap by resolving
 * the configured surface against the live catalog on every successful
 * scheduled refresh, and alerting the owner channel exactly once per
 * delisting.
 *
 * Outage immunity by construction: the refresher calls `check()` only AFTER a
 * successful `refreshFromSource()`, so a failed or partial fetch can never
 * produce 'absent' verdicts — the previous catalog entry keeps serving and the
 * drift check simply does not run that cycle. If `lookupModelById()` returns
 * `'unavailable'` (cache unreachable at lookup time), the pair is skipped for
 * that cycle with no alert and no sentinel change — only `'absent'` is drift.
 *
 * Scope: the four AdminSettings default pointers (chat + vision, global +
 * free tier — resolved to their LlmConfig rows) plus every `isGlobal` preset
 * row that routes to OpenRouter on the keyless path (`provider: 'openrouter'`
 * checked as-is; `provider: 'zai-coding'` checked under its `z-ai/`-prefixed
 * fallthrough id, mirroring `ProviderRouter.resolveRoute`). The checked id is
 * the keyless route's OpenRouter id; users with a z.ai key are promoted to
 * z.ai-direct and are not affected by an OpenRouter miss, which the alert does
 * not distinguish. The systemSettings JSONB fallback floors and the TTS
 * pointers are deliberately out of scope (different catalogs / different
 * fallback chain).
 *
 * Dedup: one Redis sentinel per (configId, modelId). First detection enqueues
 * the alert and writes the sentinel after the enqueue (so a failed enqueue
 * leaves no sentinel and retries on the next cycle, while a failed sentinel
 * write logs and leaves the pair to re-alert on the next cycle — a Redis WRITE
 * outage re-alerts each cycle, unlike a read outage, which suppresses); an
 * already-set sentinel suppresses. Each api-gateway process runs its own
 * refresher (`services/api-gateway/src/services/ModelCatalogRefresher.ts`
 * `createIntervalScheduler`), so with several replicas a newly drifted pair
 * can alert once per replica before the sentinel lands (not verified how many
 * replicas run). A later cycle where the id resolves again (re-added to the
 * catalog or re-pointed) DELETES the sentinel — recovery clears the dedup so a
 * future delisting of the same pair alerts again. No recovery alert: the alert
 * that matters is the broken state, not the healed one. A role ADDED to an
 * already-sentineled pair stays silent until that recovery (the early-return
 * skips the role list).
 *
 * Redis is fail-open throughout (the 03-database counter posture): a Redis
 * hiccup suppresses an alert or re-alerts on the next cycle at worst — it
 * never throws out of the refresh tick.
 */

import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import { AIProvider, toZaiOpenRouterFallthroughId } from '@tzurot/common-types/constants/ai';
import { JobType, REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import type { CatalogDriftEntry, CatalogDriftKind } from '@tzurot/common-types/types/jobs';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { addValidatedJob } from '../utils/validatedQueue.js';
import type { OpenRouterModelCache } from './OpenRouterModelCache.js';
import type { LlmConfigService } from './LlmConfigService.js';

const logger = createLogger('CatalogDriftChecker');

/** Mirrors LlmConfigService.list's isGlobal enumeration bound. */
const GLOBAL_SCAN_LIMIT = 100;

/** The config columns the checker reads off an LlmConfig row. */
interface ConfigRowRef {
  id: string;
  name: string;
  model: string;
  provider: string;
}

/** One (config, model, role) triple to resolve against the catalog. */
interface WatchTarget extends ConfigRowRef {
  kind: CatalogDriftKind;
}

/**
 * A (configId, modelId) pair with every role the config serves it in — the
 * sentinel's granularity: one pair, one alert, all its roles on it.
 */
interface DriftPair {
  configId: string;
  configName: string;
  modelId: string;
  kinds: CatalogDriftKind[];
}

export interface CatalogDriftCheckerDeps {
  prisma: PrismaClient;
  llmConfigService: Pick<LlmConfigService, 'getDefaultPointerIds'>;
  modelCache: Pick<OpenRouterModelCache, 'lookupModelById'>;
  redis: Pick<Redis, 'get' | 'set' | 'del'>;
  queue: Queue;
  /** Injectable clock for deterministic job ids in tests/fixtures. */
  now?: () => Date;
}

/**
 * The whole-cycle orchestrator. Collects ALL newly-detected drifts in the
 * cycle into ONE batched alert job — the owner channel sees one embed per
 * refresh cycle, not one per config.
 */
export class CatalogDriftChecker {
  private readonly now: () => Date;

  constructor(private readonly deps: CatalogDriftCheckerDeps) {
    this.now = deps.now ?? ((): Date => new Date());
  }

  async check(): Promise<void> {
    const targets = await this.resolveWatchTargets();
    const drifts: CatalogDriftEntry[] = [];
    const sentinelKeys: string[] = [];
    let recoveries = 0;
    let unavailable = 0;

    // Group by (configId, modelId): the sentinel is per PAIR, but a config can
    // appear under two roles (pointer target AND global preset), and both role
    // entries ride the pair's single first-detection alert.
    const byPair = new Map<string, DriftPair>();
    for (const target of targets) {
      const key = `${target.id}\n${target.model}`;
      const entry = byPair.get(key);
      if (entry === undefined) {
        byPair.set(key, {
          configId: target.id,
          configName: target.name,
          modelId: target.model,
          kinds: [target.kind],
        });
      } else if (!entry.kinds.includes(target.kind)) {
        entry.kinds.push(target.kind);
      }
    }

    for (const pair of byPair.values()) {
      const outcome = await this.evaluatePair(pair);
      drifts.push(...outcome.drifts);
      sentinelKeys.push(...outcome.sentinelKeys);
      recoveries += outcome.cleared;
      unavailable += outcome.unavailable;
    }

    if (recoveries > 0) {
      logger.info({ recoveries }, 'Catalog drift recovered — sentinels cleared');
    }
    if (unavailable > 0) {
      logger.warn(
        { unavailable },
        'Catalog lookup unavailable for some pairs — drift check skipped them this cycle'
      );
    }
    if (drifts.length === 0) {
      return;
    }

    // Unique per cycle: the sentinel (not the job id) carries the
    // alerts-once-per-delisting dedup, so a later cycle's new drifts must not
    // be swallowed behind a completed earlier job. Colon-free: BullMQ rejects
    // most colon-bearing custom job ids (see assertJobIdShape).
    const stamp = this.now().toISOString().replaceAll(':', '-');
    await addValidatedJob(
      this.deps.queue,
      JobType.CatalogDriftAlert,
      {
        requestId: `catalog-drift-${stamp}`,
        jobType: JobType.CatalogDriftAlert,
        responseDestination: { type: 'api' },
        drifts,
      },
      { jobId: `catalog-drift-${stamp}` }
    );
    for (const sentinelKey of sentinelKeys) {
      try {
        await this.deps.redis.set(sentinelKey, '1');
      } catch (err) {
        logger.warn({ err, sentinelKey }, 'Drift sentinel write failed (fail-open)');
      }
    }
    logger.info(
      { driftCount: drifts.length, jobId: `catalog-drift-${stamp}` },
      'Catalog drift detected — owner alert enqueued'
    );
  }

  /**
   * Resolve one (configId, modelId) pair against the catalog and apply the
   * sentinel protocol. `resolved` clears the sentinel (recovery — `del` on an
   * absent key is a no-op, so this stays one command per healthy pair per
   * cycle); `unavailable` skips the pair without touching the sentinel; `absent`
   * returns its role entries and the sentinel key to set ONLY on first
   * detection (`check()` writes the sentinel after `addValidatedJob` resolves).
   */
  private async evaluatePair(pair: DriftPair): Promise<{
    drifts: CatalogDriftEntry[];
    sentinelKeys: string[];
    cleared: number;
    unavailable: number;
  }> {
    const sentinelKey = this.sentinelKey(pair.configId, pair.modelId);
    const lookup = await this.deps.modelCache.lookupModelById(pair.modelId);
    if (lookup.kind === 'resolved') {
      try {
        return {
          drifts: [],
          sentinelKeys: [],
          cleared: await this.deps.redis.del(sentinelKey),
          unavailable: 0,
        };
      } catch (err) {
        logger.warn({ err, configId: pair.configId }, 'Drift sentinel cleanup failed (fail-open)');
        return { drifts: [], sentinelKeys: [], cleared: 0, unavailable: 0 };
      }
    }
    if (lookup.kind === 'unavailable') {
      return { drifts: [], sentinelKeys: [], cleared: 0, unavailable: 1 };
    }
    try {
      if ((await this.deps.redis.get(sentinelKey)) !== null) {
        return { drifts: [], sentinelKeys: [], cleared: 0, unavailable: 0 };
      }
    } catch (err) {
      // Fail-open toward suppression: the pair is skipped this cycle and
      // re-evaluated when Redis is healthy, so an outage never spams.
      logger.warn(
        { err, configId: pair.configId },
        'Drift sentinel read failed (suppressed this cycle)'
      );
      return { drifts: [], sentinelKeys: [], cleared: 0, unavailable: 0 };
    }
    return {
      drifts: pair.kinds.map(kind => ({
        configId: pair.configId,
        configName: pair.configName,
        modelId: pair.modelId,
        kind,
      })),
      sentinelKeys: [sentinelKey],
      cleared: 0,
      unavailable: 0,
    };
  }

  private sentinelKey(configId: string, modelId: string): string {
    // configId is a fixed-shape UUID, so the first ':' after it unambiguously
    // splits the pair even for a model id containing ':' of its own.
    return `${REDIS_KEY_PREFIXES.CATALOG_DRIFT_SENTINEL}${configId}:${modelId}`;
  }

  /**
   * Mirrors ProviderRouter.resolveRoute's keyless path: returns the OpenRouter
   * model id a keyless user's request would hit, or null when the row does not
   * route to OpenRouter.
   */
  private resolveOpenRouterModelId(row: ConfigRowRef): string | null {
    if (row.model === '') {
      return null;
    }
    if (row.provider === (AIProvider.OpenRouter as string)) {
      return row.model;
    }
    if (row.provider === (AIProvider.ZaiCoding as string)) {
      return toZaiOpenRouterFallthroughId(row.model);
    }
    return null;
  }

  /**
   * The configured surface: pointer targets (chat + vision, global + free)
   * plus every global preset. Each row's `model` is rewritten to the keyless
   * route's OpenRouter id (`openrouter` as-is, `zai-coding` under its `z-ai/`
   * fallthrough id; users with a z.ai key are promoted to z.ai-direct and are
   * not affected by an OpenRouter miss, which the alert does not distinguish).
   * Null pointers return no row; empty-string models and providers without an
   * OpenRouter route are skipped.
   */
  private async resolveWatchTargets(): Promise<WatchTarget[]> {
    const { globalDefaultIds, freeDefaultIds } =
      await this.deps.llmConfigService.getDefaultPointerIds();

    const [pointerRows, globalRows] = await Promise.all([
      this.deps.prisma.llmConfig.findMany({
        where: { id: { in: [...globalDefaultIds, ...freeDefaultIds] } },
        select: { id: true, name: true, model: true, provider: true },
        orderBy: { name: 'asc' },
        take: globalDefaultIds.size + freeDefaultIds.size,
      }),
      this.deps.prisma.llmConfig.findMany({
        where: { isGlobal: true },
        select: { id: true, name: true, model: true, provider: true },
        orderBy: { name: 'asc' },
        take: GLOBAL_SCAN_LIMIT,
      }),
    ]);

    const targets: WatchTarget[] = [];
    for (const row of pointerRows) {
      const model = this.resolveOpenRouterModelId(row);
      if (model === null) {
        continue;
      }
      if (globalDefaultIds.has(row.id)) {
        targets.push({ ...row, model, kind: 'default' });
      }
      if (freeDefaultIds.has(row.id)) {
        targets.push({ ...row, model, kind: 'free-default' });
      }
    }
    for (const row of globalRows) {
      const model = this.resolveOpenRouterModelId(row);
      if (model !== null) {
        targets.push({ ...row, model, kind: 'global' });
      }
    }
    if (globalRows.length >= GLOBAL_SCAN_LIMIT) {
      logger.warn(
        { limit: GLOBAL_SCAN_LIMIT },
        'Global-preset scan hit its bound — presets past it are NOT drift-checked'
      );
    }
    return targets;
  }
}
