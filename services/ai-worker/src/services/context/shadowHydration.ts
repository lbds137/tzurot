/**
 * Shadow context hydration — burn-in instrumentation for the context-assembly
 * relocation. Remove when `CONTEXT_SHADOW_HYDRATION` is retired.
 *
 * When `CONTEXT_SHADOW_HYDRATION=true`, every LLM job ALSO hydrates the
 * DB-derived context via ContextDataSource and diffs it against the
 * bot-client-assembled payload, logging a structured summary. Generation is
 * never affected: the payload remains the source of truth, hydration runs
 * fire-and-forget, and every failure is swallowed into a debug log.
 *
 * Diff tolerance is deliberate — exact equality is NOT expected:
 * - The payload's conversationHistory merges DB rows with Discord-fetched
 *   extended-context messages; only entries carrying a DB `id` are compared.
 * - Time passes between bot-client's fetch and job processing, so hydration
 *   may see rows the payload predates (`extraInHydrated` — expected for the
 *   newest messages, including the triggering message itself once persisted).
 * - Limit derivation differs subtly today: bot-client uses
 *   `extendedContext?.maxMessages ?? DEFAULT` while hydration uses the
 *   resolved cascade value directly. The summary logs the limit used so
 *   burn-in analysis can attribute count differences. Surfacing this class
 *   of divergence is the point of the shadow window.
 */

import {
  createLogger,
  MESSAGE_LIMITS,
  type JobContext,
  type ResolvedConfigOverrides,
} from '@tzurot/common-types';
import type { ContextDataSource } from './types.js';

const logger = createLogger('ShadowHydration');

export function isShadowHydrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CONTEXT_SHADOW_HYDRATION === 'true';
}

interface ShadowParams {
  jobId: string | number | undefined;
  jobContext: JobContext;
  personalityId: string;
  configOverrides: ResolvedConfigOverrides | undefined;
  dataSource: ContextDataSource;
}

interface HistoryDiff {
  payloadDbCount: number;
  hydratedCount: number;
  missingFromHydrated: number;
  extraInHydrated: number;
}

function diffHistoryIds(payloadIds: Set<string>, hydratedIds: Set<string>): HistoryDiff {
  let missingFromHydrated = 0;
  for (const id of payloadIds) {
    if (!hydratedIds.has(id)) {
      missingFromHydrated++;
    }
  }
  let extraInHydrated = 0;
  for (const id of hydratedIds) {
    if (!payloadIds.has(id)) {
      extraInHydrated++;
    }
  }
  return {
    payloadDbCount: payloadIds.size,
    hydratedCount: hydratedIds.size,
    missingFromHydrated,
    extraInHydrated,
  };
}

/** Payload omits the field for UTC users; treat undefined as 'UTC'. */
async function compareTimezone(
  dataSource: ContextDataSource,
  jobContext: JobContext,
  userInternalId: string | undefined
): Promise<boolean | undefined> {
  if (userInternalId === undefined) {
    return undefined;
  }
  const hydratedTimezone = await dataSource.getUserTimezone(userInternalId);
  return hydratedTimezone === (jobContext.userTimezone ?? 'UTC');
}

interface CrossChannelCompareParams {
  dataSource: ContextDataSource;
  jobContext: JobContext;
  personalityId: string;
  configOverrides: ResolvedConfigOverrides | undefined;
  channelId: string;
  activePersonaId: string | undefined;
  limit: number;
  maxAgeSeconds: number | undefined;
  contextEpoch: Date | undefined;
}

/**
 * Count-only comparison BY DESIGN: the payload carries
 * `CrossChannelHistoryGroupEntry[]` (Discord wire format, keyed by
 * `channelEnvironment`) while hydration returns `CrossChannelHistoryGroup[]`
 * (DB service format, keyed by `channelId`) — structurally unrelated types.
 * The cutover slice must unify these shapes before any deep diff is possible;
 * until then, group counts are the comparable signal.
 */
async function compareCrossChannel(
  params: CrossChannelCompareParams
): Promise<{ payloadGroups: number; hydratedGroups: number } | undefined> {
  const { dataSource, jobContext, configOverrides, activePersonaId } = params;
  if (
    configOverrides?.crossChannelHistoryEnabled !== true ||
    jobContext.isWeighIn === true ||
    activePersonaId === undefined
  ) {
    return undefined;
  }
  const hydratedGroups = await dataSource.getCrossChannelHistory({
    personaId: activePersonaId,
    personalityId: params.personalityId,
    excludeChannelId: params.channelId,
    limit: params.limit,
    maxAgeSeconds: params.maxAgeSeconds,
    contextEpoch: params.contextEpoch,
  });
  return {
    payloadGroups: jobContext.crossChannelHistory?.length ?? 0,
    hydratedGroups: hydratedGroups.length,
  };
}

/**
 * Hydrate the DB-derived context and log a comparison summary.
 * Fire-and-forget: never throws, never blocks the pipeline.
 */
export async function shadowHydrateAndDiff(params: ShadowParams): Promise<void> {
  try {
    const { jobContext, personalityId, configOverrides, dataSource } = params;
    const { channelId, userInternalId, activePersonaId } = jobContext;
    if (channelId === undefined || channelId.length === 0) {
      return;
    }

    // Mirror the bot-client dbLimit derivation as closely as the resolved
    // cascade allows (see module JSDoc for the known divergence).
    const limit = Math.min(
      configOverrides?.maxMessages ?? MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES,
      MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT
    );
    const maxAgeSeconds = configOverrides?.maxAge ?? undefined;

    // Epoch is an INPUT to history filtering (the payload doesn't carry it);
    // hydrating it exercises the same lookup bot-client performs.
    const contextEpoch =
      userInternalId !== undefined && activePersonaId !== undefined
        ? await dataSource.getContextEpoch(userInternalId, personalityId, activePersonaId)
        : undefined;

    const hydratedHistory = await dataSource.getChannelHistory(
      channelId,
      limit,
      contextEpoch,
      maxAgeSeconds
    );

    const payloadDbIds = new Set(
      (jobContext.conversationHistory ?? [])
        .map(msg => msg.id)
        .filter((id): id is string => id !== undefined && id.length > 0)
    );
    // Filter symmetrically with the payload side — a hypothetical id-less DB
    // row must not inflate extraInHydrated.
    const hydratedIds = new Set(
      hydratedHistory.map(m => m.id).filter((id): id is string => id !== undefined && id.length > 0)
    );
    const historyDiff = diffHistoryIds(payloadDbIds, hydratedIds);

    const timezoneMatch = await compareTimezone(dataSource, jobContext, userInternalId);
    const crossChannelDiff = await compareCrossChannel({
      dataSource,
      jobContext,
      personalityId,
      configOverrides,
      channelId,
      activePersonaId,
      limit,
      maxAgeSeconds,
      contextEpoch,
    });

    // `extraInHydrated` alone is the expected-drift case (new rows persisted
    // since the bot-client fetch); anything missing from hydration, a
    // timezone mismatch, or hydration seeing FEWER cross-channel groups than
    // the payload (more is timing drift, fewer is a lost-data regression) is
    // a real divergence worth a warn.
    const crossChannelRegressed =
      crossChannelDiff !== undefined &&
      crossChannelDiff.hydratedGroups < crossChannelDiff.payloadGroups;
    const diverged =
      historyDiff.missingFromHydrated > 0 || timezoneMatch === false || crossChannelRegressed;
    const summary = {
      jobId: params.jobId,
      limit,
      maxAgeSeconds: maxAgeSeconds ?? null,
      contextEpoch: contextEpoch?.toISOString() ?? null,
      historyDiff,
      timezoneMatch,
      crossChannelDiff,
    };

    if (diverged) {
      logger.warn(summary, 'Shadow hydration DIVERGED from bot-client payload');
    } else {
      logger.info(summary, 'Shadow hydration matched bot-client payload');
    }
  } catch (error) {
    // Shadow instrumentation must never surface as a pipeline failure.
    logger.debug({ err: error, jobId: params.jobId }, 'Shadow hydration failed (ignored)');
  }
}
