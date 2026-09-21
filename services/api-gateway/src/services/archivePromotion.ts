/**
 * Memory-archive auto-promotion.
 *
 * Evaluates every personality's archive-summary coverage against the flip
 * gate (`FLIP_GATE_TARGET`, shared with the tooling pre-warm sweep report)
 * and promotes anyone at or above it into the two memory-archive render
 * lists (`archiveSplitRenderPersonalities`, `recentDaysDigestPersonalities`)
 * plus the personality's own `crossChannelRenderMode: 'user-only'` tier
 * default — filled in only when the personality carries no explicit
 * `crossChannelRenderMode`. Gated end-to-end by the `archivePromotionEnabled`
 * kill switch and a per-personality opt-out list, both read from
 * `system_settings`.
 */

import { Prisma, type PrismaClient } from '@tzurot/common-types/services/prisma';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import { ARCHIVE_SUMMARY_PROMPT_VERSION } from '@tzurot/common-types/constants/memoryArchive';
import {
  FLIP_GATE_TARGET,
  SUMMARY_COVERAGE_WINDOW_DAYS,
  summarizedShare,
} from '@tzurot/common-types/utils/summaryCoverage';
import type {
  MemoryArchivePromoteResponse,
  MemoryArchivePromotion,
} from '@tzurot/common-types/schemas/api/memoryArchive';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type {
  ConfigCascadeCacheInvalidationService,
  SystemSettingsCacheInvalidationService,
} from '@tzurot/cache-invalidation';
import { tryInvalidateCache } from '../utils/configOverrideHelpers.js';
import { mergeConfigOverrides } from '../utils/configOverrideMerge.js';
import {
  ARCHIVE_COVERAGE_SQL,
  MAX_PERSONALITIES_EVALUATED,
  type ArchiveCoverageRow,
} from './archivePromotionSql.js';
import {
  asBag,
  readBoolSetting,
  readSlugListSettingLenient,
  readSlugListSettingStrict,
  MalformedSettingsList,
} from './archivePromotionSettings.js';

const logger = createLogger('archivePromotion');

export interface ArchivePromotionDeps {
  prisma: PrismaClient;
  systemSettingsInvalidation?: SystemSettingsCacheInvalidationService;
  cascadeInvalidation?: ConfigCascadeCacheInvalidationService;
}

/** True when the stored bag carries an explicit `crossChannelRenderMode` — any string value the schema accepts. */
function hasExplicitRenderMode(configDefaults: unknown): boolean {
  return typeof asBag(configDefaults).crossChannelRenderMode === 'string';
}

/** Thrown when the singleton settings row moved between read and write; caught per-candidate outside the transaction. */
class ConcurrentSettingsWrite extends Error {}

/** Thrown when the personality-tier config-defaults merge rejects the write; caught per-candidate outside the transaction. */
class InvalidConfigDefaultsMerge extends Error {}

/** Thrown when the personality row vanished or moved between the in-transaction re-read and the write; caught per-candidate outside the transaction. */
class ConcurrentPersonalityWrite extends Error {}

interface PromotionCandidate {
  personalityId: string;
  slug: string;
  coverage: number;
  configDefaults: unknown;
}

/**
 * The personality half of a promotion, run inside the caller's transaction:
 * re-read the row, decide explicitness from THAT read rather than the batch
 * snapshot, and write the merged defaults under the row's own `updatedAt`
 * guard. Throws `ConcurrentPersonalityWrite` when the row vanished or moved
 * under the transaction.
 */
// @spec MEM-ARCH-036
async function writePersonalityRenderMode(
  tx: Prisma.TransactionClient,
  candidate: PromotionCandidate
): Promise<{ renderModeExplicit: boolean }> {
  const fresh = await tx.personality.findUnique({
    where: { id: candidate.personalityId },
    select: { configDefaults: true, updatedAt: true },
  });
  if (fresh === null) {
    throw new ConcurrentPersonalityWrite();
  }
  const renderModeExplicit = hasExplicitRenderMode(fresh.configDefaults);
  if (renderModeExplicit) {
    return { renderModeExplicit };
  }
  const mergedDefaults = mergeConfigOverrides(fresh.configDefaults, {
    crossChannelRenderMode: 'user-only',
  });
  if (mergedDefaults === 'invalid') {
    throw new InvalidConfigDefaultsMerge();
  }
  const { count } = await tx.personality.updateMany({
    where: { id: candidate.personalityId, updatedAt: fresh.updatedAt },
    data: {
      configDefaults:
        mergedDefaults === null ? Prisma.JsonNull : (mergedDefaults as Prisma.InputJsonValue),
    },
  });
  if (count !== 1) {
    throw new ConcurrentPersonalityWrite();
  }
  return { renderModeExplicit };
}

/**
 * Promote one candidate: append its slug to both render lists (re-reading
 * the settings row fresh so a batch of promotions accumulates rather than
 * clobbering each other) and set its personality-tier render-mode override
 * when it carries no explicit one, all in one transaction. Both writes are
 * guarded by their own row's `updatedAt`. The settings write happens BEFORE
 * the personality write — load-bearing: a personality write that throws
 * must roll the settings-list appends back with it. The personality guard
 * closes the window between the batch snapshot (`classifyCandidates`) and
 * this transaction: explicitness is decided from the row as re-read here,
 * not from the candidate's snapshot value. A render list that is present
 * but malformed throws out of the transaction and is counted
 * `skipped.conflicted`, so nothing reconstructed is ever persisted.
 */
async function promoteOne(
  prisma: PrismaClient,
  candidate: PromotionCandidate
): Promise<MemoryArchivePromotion | null> {
  let digestAlreadyHad = false;
  let splitAlreadyHad = false;
  let renderModeExplicit = false;

  try {
    await prisma.$transaction(async tx => {
      const current = await tx.adminSettings.findUnique({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        select: { systemSettings: true, updatedAt: true },
      });
      if (current === null) {
        throw new ConcurrentSettingsWrite();
      }

      const bag = asBag(current.systemSettings);
      const splitRenderList = readSlugListSettingStrict(bag, 'archiveSplitRenderPersonalities');
      const digestList = readSlugListSettingStrict(bag, 'recentDaysDigestPersonalities');
      splitAlreadyHad = splitRenderList.includes(candidate.slug);
      digestAlreadyHad = digestList.includes(candidate.slug);

      const merged = {
        ...bag,
        archiveSplitRenderPersonalities: splitAlreadyHad
          ? splitRenderList
          : [...splitRenderList, candidate.slug],
        recentDaysDigestPersonalities: digestAlreadyHad
          ? digestList
          : [...digestList, candidate.slug],
      };

      const { count } = await tx.adminSettings.updateMany({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID, updatedAt: current.updatedAt },
        data: { systemSettings: merged },
      });
      if (count === 0) {
        throw new ConcurrentSettingsWrite();
      }

      const personalityWrite = await writePersonalityRenderMode(tx, candidate);
      renderModeExplicit = personalityWrite.renderModeExplicit;
    });
  } catch (error) {
    if (error instanceof MalformedSettingsList) {
      logger.warn(
        { personalityId: candidate.personalityId, key: error.key },
        'Archive promotion skipped: settings list is malformed'
      );
      return null;
    }
    if (error instanceof ConcurrentSettingsWrite) {
      logger.warn(
        { personalityId: candidate.personalityId },
        'Archive promotion skipped: settings row changed concurrently'
      );
      return null;
    }
    if (error instanceof InvalidConfigDefaultsMerge) {
      logger.warn(
        { personalityId: candidate.personalityId },
        'Archive promotion skipped: personality config-defaults merge was invalid'
      );
      return null;
    }
    if (error instanceof ConcurrentPersonalityWrite) {
      logger.warn(
        { personalityId: candidate.personalityId },
        'Archive promotion skipped: personality row changed concurrently'
      );
      return null;
    }
    throw error;
  }

  const writes = {
    archiveSplitRender: !splitAlreadyHad,
    recentDaysDigest: !digestAlreadyHad,
    renderMode: !renderModeExplicit,
  };
  logger.info(
    { personalityId: candidate.personalityId, coverage: candidate.coverage, writes },
    'Memory archive promotion'
  );
  return {
    personalityId: candidate.personalityId,
    slug: candidate.slug,
    coverage: candidate.coverage,
    writes,
  };
}

/** After a real (non-dry-run) promotion batch, publish both invalidations; a throw here never fails the response. */
async function invalidateAfterPromotion(
  deps: ArchivePromotionDeps,
  promoted: MemoryArchivePromotion[]
): Promise<void> {
  const { systemSettingsInvalidation, cascadeInvalidation } = deps;

  await tryInvalidateCache(
    systemSettingsInvalidation === undefined
      ? undefined
      : () =>
          systemSettingsInvalidation.invalidateKeys([
            'archiveSplitRenderPersonalities',
            'recentDaysDigestPersonalities',
          ]),
    {}
  );
  if (systemSettingsInvalidation === undefined) {
    logger.warn(
      { promoted: promoted.length },
      'System-settings invalidation service unavailable after archive promotion'
    );
  }

  if (cascadeInvalidation === undefined) {
    logger.warn(
      { promoted: promoted.length },
      'Cascade invalidation service unavailable after archive promotion'
    );
    return;
  }
  for (const promotion of promoted) {
    await tryInvalidateCache(
      cascadeInvalidation.invalidatePersonality.bind(cascadeInvalidation, promotion.personalityId),
      { personalityId: promotion.personalityId }
    );
  }
}

interface ReadyClassification {
  /** Personality ids whose coverage share is at or above `FLIP_GATE_TARGET`. */
  readyIds: string[];
  /** Each ready id's share, carried forward so candidates don't re-derive it. */
  coverageByPersonalityId: Map<string, number>;
  /** Count of rows below the gate (including a null share on a zero denominator). */
  notReady: number;
}

/** Splits the raw coverage rows into ready ids (>= the flip gate) vs. not-ready counts. */
function classifyCoverageRows(coverageRows: ArchiveCoverageRow[]): ReadyClassification {
  const coverageByPersonalityId = new Map<string, number>();
  const readyIds: string[] = [];
  let notReady = 0;
  for (const row of coverageRows) {
    const share = summarizedShare(row);
    if (share !== null && share >= FLIP_GATE_TARGET) {
      readyIds.push(row.personality_id);
      coverageByPersonalityId.set(row.personality_id, share);
    } else {
      notReady += 1;
    }
  }
  return { readyIds, coverageByPersonalityId, notReady };
}

interface LoadedPersonality {
  id: string;
  slug: string;
  configDefaults: unknown;
}

interface CandidateClassification {
  candidates: PromotionCandidate[];
  optedOut: number;
  alreadyListed: number;
}

/**
 * Turns ready personalities into promotion candidates, first-match-wins:
 * opted out → fully converged → candidate. "Converged" means the slug is on
 * BOTH render lists (`splitRenderList` and `digestList`) AND its
 * `configDefaults` already carries an explicit `crossChannelRenderMode` of
 * any value — a partial match (e.g. split-listed but missing the digest
 * listing) still becomes a candidate so the missing writes are performed.
 */
function classifyCandidates(
  personalities: LoadedPersonality[],
  optOutList: string[],
  splitRenderList: string[],
  digestList: string[],
  coverageByPersonalityId: Map<string, number>
): CandidateClassification {
  const candidates: PromotionCandidate[] = [];
  let optedOut = 0;
  let alreadyListed = 0;
  for (const personality of personalities) {
    if (optOutList.includes(personality.slug)) {
      optedOut += 1;
      continue;
    }
    // Batch-snapshot read on purpose: this is a pre-filter. The authoritative
    // render-mode decision is re-read inside the promotion transaction.
    const converged =
      splitRenderList.includes(personality.slug) &&
      digestList.includes(personality.slug) &&
      hasExplicitRenderMode(personality.configDefaults);
    if (converged) {
      alreadyListed += 1;
      continue;
    }
    candidates.push({
      personalityId: personality.id,
      slug: personality.slug,
      // Every id here came from readyIds, which is exactly what seeded the
      // map — the fallback is unreachable, not a real degraded path.
      coverage: coverageByPersonalityId.get(personality.id) ?? 0,
      configDefaults: personality.configDefaults,
    });
  }
  return { candidates, optedOut, alreadyListed };
}

/** Dry-run projection: the writes each candidate WOULD receive, no I/O. */
function buildDryRunPromotions(
  candidates: PromotionCandidate[],
  digestListSnapshot: string[],
  splitRenderListSnapshot: string[]
): MemoryArchivePromotion[] {
  return candidates.map(candidate => ({
    personalityId: candidate.personalityId,
    slug: candidate.slug,
    coverage: candidate.coverage,
    writes: {
      archiveSplitRender: !splitRenderListSnapshot.includes(candidate.slug),
      recentDaysDigest: !digestListSnapshot.includes(candidate.slug),
      // Batch-snapshot read on purpose: a dry run is a projection, not a write.
      renderMode: !hasExplicitRenderMode(candidate.configDefaults),
    },
  }));
}

/** @spec MEM-ARCH-033 */
export async function runArchivePromotion(
  deps: ArchivePromotionDeps,
  options: { dryRun?: boolean } = {}
): Promise<MemoryArchivePromoteResponse> {
  const { prisma } = deps;
  const dryRun = options.dryRun === true;

  const settingsRow = await prisma.adminSettings.findUnique({
    where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    select: { systemSettings: true },
  });
  const bag = asBag(settingsRow?.systemSettings);

  if (!readBoolSetting(bag)) {
    return {
      enabled: false,
      evaluated: 0,
      promoted: [],
      skipped: { notReady: 0, optedOut: 0, alreadyListed: 0, conflicted: 0 },
    };
  }

  const optOutList = readSlugListSettingLenient(bag, 'archivePromotionOptOutPersonalities');
  const splitRenderList = readSlugListSettingLenient(bag, 'archiveSplitRenderPersonalities');
  const digestListSnapshot = readSlugListSettingLenient(bag, 'recentDaysDigestPersonalities');

  const coverageRows = await prisma.$queryRawUnsafe<ArchiveCoverageRow[]>(
    ARCHIVE_COVERAGE_SQL,
    ARCHIVE_SUMMARY_PROMPT_VERSION,
    SUMMARY_COVERAGE_WINDOW_DAYS,
    MAX_PERSONALITIES_EVALUATED
  );

  const {
    readyIds,
    coverageByPersonalityId,
    notReady: coverageNotReady,
  } = classifyCoverageRows(coverageRows);

  const personalities =
    readyIds.length === 0
      ? []
      : await prisma.personality.findMany({
          where: { id: { in: readyIds } },
          select: { id: true, slug: true, configDefaults: true },
          take: readyIds.length,
        });
  // A ready id with no matching personality row cannot be promoted.
  const missingRowNotReady = readyIds.length - personalities.length;

  const { candidates, optedOut, alreadyListed } = classifyCandidates(
    personalities,
    optOutList,
    splitRenderList,
    digestListSnapshot,
    coverageByPersonalityId
  );
  // Identity maintained by every branch below: evaluated === promoted.length
  // + notReady + optedOut + alreadyListed + conflicted. Pinned by the
  // concurrent-write case in archivePromotion.test.ts and the convergence
  // case in archivePromotion.component.test.ts.
  const skipped = {
    notReady: coverageNotReady + missingRowNotReady,
    optedOut,
    alreadyListed,
  };

  if (dryRun) {
    const promoted = buildDryRunPromotions(candidates, digestListSnapshot, splitRenderList);
    return {
      enabled: true,
      evaluated: coverageRows.length,
      promoted,
      skipped: { ...skipped, conflicted: 0 },
    };
  }

  // The invalidation must fire for whatever committed even if a LATER
  // candidate's write throws — earlier candidates in this batch already
  // committed their transactions, so skipping invalidation on the way out
  // would leave every reader serving stale caches until TTL. `finally`
  // guarantees this without swallowing the error: the throw still propagates
  // (to the scheduler's failure embed, and to whatever caller awaited this).
  const promoted: MemoryArchivePromotion[] = [];
  let conflicted = 0;
  try {
    for (const candidate of candidates) {
      const promotion = await promoteOne(prisma, candidate);
      if (promotion !== null) {
        promoted.push(promotion);
      } else {
        conflicted += 1;
      }
    }
  } finally {
    if (promoted.length > 0) {
      await invalidateAfterPromotion(deps, promoted);
    }
  }

  return {
    enabled: true,
    evaluated: coverageRows.length,
    promoted,
    skipped: { ...skipped, conflicted },
  };
}
