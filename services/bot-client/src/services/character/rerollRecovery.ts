/**
 * Startup recovery for rerolls a dead process left half-done.
 *
 * `rerollInflight.ts` records, before the first Discord edit, what a restart
 * needs. This pass runs at boot and then on a periodic rescan: it
 * scans the records, takes only those another process wrote, claims each
 * atomically, and settles it through the gateway's abort, which is the one
 * place that knows whether the commit landed:
 *
 *  - `committed`: the history row already holds the new reply, so run phase 2
 *    (delete surplus chunks, clear stale attachments);
 *  - `aborted`: the attempt can never land, so put the old text back and delete
 *    the extras it sent, but only after the gateway confirms the old row is
 *    still the live row and unchanged since the record was written (an Edit
 *    Response or a later reroll may have moved on, and the Discord message then
 *    must not be touched);
 *  - `unknown` (or a repair that failed): write the record back under this
 *    process and retry on a bounded backoff, then leave it to its TTL.
 *
 * Both repairs are idempotent (a chunk already gone or already restored is
 * skipped). Logs carry ids only, never reply text.
 */

import type { Client, Message } from 'discord.js';
import type { Redis } from 'ioredis';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { sha256Hex } from '@tzurot/common-types/utils/sha256Hex';
import {
  finishEditedChunks,
  isGoneError,
  restoreEditedChunks,
  type BegunEdit,
  type EditTarget,
} from '../../utils/editResponse/discordEdit.js';
import { resolveTarget } from '../../utils/editResponse/liveTarget.js';
import { clientsForUser } from '../../utils/gatewayClients.js';
import { abortRerollDetailed } from './rerollAbort.js';
import { claimRerollGuardFor, releaseRerollGuard } from './rerollGuard.js';
import {
  REROLL_BOOT_ID,
  REROLL_INFLIGHT_MIN_AGE_MS,
  claimInflight,
  inflightRemainingMs,
  peekInflight,
  scanInflightJobIds,
  writeInflight,
  type RerollInflightRecord,
} from './rerollInflight.js';

const logger = createLogger('reroll-recovery');

/**
 * Waits before each in-process retry of a record the gateway or Discord could
 * not settle: 30 s, 2 min, 10 min. After the last, the record is left to its
 * TTL (and to the next boot).
 */
export const RECOVERY_RETRY_DELAYS_MS = [30_000, 120_000, 600_000] as const;

export interface RerollRecoveryDeps {
  client: Client;
  redis: Redis;
  /** Run `fn` once after `delayMs`; injectable for tests. Defaults to an unref'd `setTimeout`. */
  schedule?: (fn: () => Promise<void>, delayMs: number) => void;
  /** This process's boot id; its own records are never claimed. */
  bootId?: string;
}

export interface RerollRecoveryStats {
  scanned: number;
  claimed: number;
  settled: number;
  dropped: number;
  retrying: number;
}

/**
 * `held` is a retry caused by ANOTHER attempt holding the row's guard: it costs
 * no retry try (the record's `createdAt` cutoff still bounds it).
 */
type Verdict = 'settled' | 'dropped' | 'retry' | 'held';

/** Filled in by `attempt` so `settle` knows whether recovery took the guard itself, even if `attempt` throws. */
interface GuardState {
  acquired: boolean;
}

interface Resolved {
  schedule: NonNullable<RerollRecoveryDeps['schedule']>;
  bootId: string;
  client: Client;
  redis: Redis;
}

/**
 * How often the rescan looks for records again after the boot pass. Never
 * shorter than the minimum record age: a record the old process wrote just
 * after one scan is then old enough to claim at the next.
 */
export const REROLL_RECOVERY_RESCAN_MS = REROLL_INFLIGHT_MIN_AGE_MS;

/** Run `fn` once after `delayMs` on an unref'd timer (it never holds the process open). */
export function defaultSchedule(fn: () => Promise<void>, delayMs: number): void {
  setTimeout(() => {
    void fn();
  }, delayMs).unref();
}

type DiscordState =
  | { kind: 'ready'; target: EditTarget; begun: BegunEdit }
  | { kind: 'gone' }
  | { kind: 'unresolvable' };

/**
 * Rebuild what the phase functions need from the record: the live chunks that
 * still exist (a gone one is skipped), the sent extras that still exist, and
 * the edit target. A Discord failure other than "gone" throws, so the caller
 * retries.
 */
async function loadDiscordState(
  client: Client,
  record: RerollInflightRecord
): Promise<DiscordState> {
  let channel;
  try {
    channel = await client.channels.fetch(record.channelId);
  } catch (error) {
    if (isGoneError(error)) {
      return { kind: 'gone' };
    }
    throw error;
  }
  if (channel?.isTextBased() !== true) {
    return { kind: 'gone' };
  }
  const textChannel = channel;
  const fetchLive = async (id: string): Promise<Message | null> => {
    try {
      return await textChannel.messages.fetch(id);
    } catch (error) {
      if (isGoneError(error)) {
        return null;
      }
      throw error;
    }
  };
  const live: (Message | null)[] = [];
  for (const chunk of record.chunks) {
    live.push(await fetchLive(chunk.id));
  }
  const extras: Message[] = [];
  for (const id of record.extraIds) {
    const found = await fetchLive(id);
    if (found !== null) {
      extras.push(found);
    }
  }
  const present = [...live.filter((m): m is Message => m !== null), ...extras];
  if (present.length === 0) {
    return { kind: 'gone' };
  }
  const resolved = await resolveTarget(channel, present, record.personalityId, record.channelId);
  if (resolved === null) {
    return { kind: 'unresolvable' };
  }
  const edited: BegunEdit['edited'] = [];
  const surplus: Message[] = [];
  record.chunks.forEach((chunk, index) => {
    const message = live[index];
    if (message === null) {
      return;
    }
    if (index < record.editedCount) {
      edited.push({ live: message, before: chunk.before });
    } else {
      surplus.push(message);
    }
  });
  return {
    kind: 'ready',
    target: resolved.target,
    begun: {
      ok: true,
      messageIds: [],
      partial: false,
      edited,
      extras,
      surplus,
      attachmentsCleared: false,
    },
  };
}

/**
 * Whether the abort's report says the old row is still live with the content
 * the record holds. The digest is computed with the same `sha256Hex` the
 * gateway used; a newer message in the channel is no reason to skip a restore
 * (the live handler restores on a NOT_LATEST refusal too).
 */
function oldRowRestorable(
  detail: { oldRowLive: boolean; oldRowContentDigest: string | null },
  record: RerollInflightRecord
): boolean {
  return detail.oldRowLive && detail.oldRowContentDigest === sha256Hex(record.rowContent);
}

/** Delete the extras the attempt sent: no row owns them once the attempt can never land. A gone message is done. */
async function deleteExtras(client: Client, record: RerollInflightRecord): Promise<void> {
  if (record.extraIds.length === 0) {
    return;
  }
  let channel;
  try {
    channel = await client.channels.fetch(record.channelId);
  } catch (error) {
    if (isGoneError(error)) {
      return;
    }
    throw error;
  }
  if (channel?.isTextBased() !== true) {
    return;
  }
  for (const id of record.extraIds) {
    try {
      const message = await channel.messages.fetch(id);
      await message.delete();
    } catch (error) {
      if (!isGoneError(error)) {
        throw error;
      }
    }
  }
}

/**
 * One settlement attempt under the row's guard. Throws only on an unexpected
 * Discord failure (the caller retries).
 */
async function attempt(
  record: RerollInflightRecord,
  deps: Resolved,
  guard: GuardState
): Promise<Verdict> {
  const { jobId, rowId } = record;
  // Restore and finish write the row's Discord messages; a newer attempt on the
  // row (guard held by someone else) must not race them.
  const claim = await claimRerollGuardFor(deps.redis, rowId, record.attemptId);
  if (claim === 'held') {
    logger.warn({ jobId, rowId }, 'Reroll recovery found the row guard held by another attempt');
    return 'held';
  }
  guard.acquired = claim === 'acquired';
  const actor = await deps.client.users.fetch(record.actorId).catch((err: unknown) => {
    logger.warn({ err, jobId, rowId }, 'Reroll recovery could not fetch the actor');
    return null;
  });
  if (actor === null) {
    return 'retry';
  }
  const { userClient } = clientsForUser(actor);
  // The gateway reads the attempt's memory ids from the job's stored result; the
  // record's own ids are its fallback when that result is missing.
  const detail = await abortRerollDetailed({
    jobId,
    userClient,
    routeKey: record.routeKey,
    rowId,
    attemptId: record.attemptId,
    keepMemoryIds: record.keepMemoryIds,
    newMemoryIds: record.newMemoryIds,
    newPendingIds: record.newPendingIds,
  });
  if (detail.kind === 'unknown') {
    return 'retry';
  }
  if (detail.kind === 'refused') {
    // A refusal carries no answer about whether the commit landed (the extras may
    // belong to a committed reply), so nothing on Discord is touched.
    logger.warn(
      { jobId, rowId, status: detail.status, extraIds: record.extraIds },
      'Reroll recovery dropped a record: the gateway refuses its abort for good; extra messages left untouched'
    );
    return 'dropped';
  }
  if (detail.kind === 'aborted' && !oldRowRestorable(detail, record)) {
    // The old row is gone, replaced or edited since the record was written: the
    // original messages are not this attempt's to touch, but the extras it sent
    // belong to no row.
    await deleteExtras(deps.client, record);
    logger.warn(
      { jobId, rowId },
      'Reroll recovery dropped a record: the old row changed since it was written, original messages left untouched'
    );
    return 'dropped';
  }
  const state = await loadDiscordState(deps.client, record);
  if (state.kind === 'unresolvable') {
    // Possibly a transient webhook failure: the attempt is already tombstoned, so
    // settling here would leave the new text on Discord against the old history.
    logger.warn({ jobId, rowId }, 'Reroll recovery could not resolve an edit target; will retry');
    return 'retry';
  }
  if (state.kind !== 'ready') {
    logger.warn(
      { jobId, rowId },
      'Reroll recovery found no Discord message left to repair; nothing to do'
    );
    return 'settled';
  }
  if (detail.kind === 'committed') {
    const finished = await finishEditedChunks(state.target, state.begun);
    return finished.ok ? 'settled' : 'retry';
  }
  return (await restoreEditedChunks(state.target, state.begun)) ? 'settled' : 'retry';
}

async function settle(
  record: RerollInflightRecord,
  deps: Resolved,
  tries: number
): Promise<Verdict> {
  const guard: GuardState = { acquired: false };
  let verdict: Verdict;
  try {
    verdict = await attempt(record, deps, guard);
  } catch (err) {
    logger.warn(
      { err, jobId: record.jobId, rowId: record.rowId },
      'Reroll recovery attempt failed'
    );
    verdict = 'retry';
  }
  const releaseGuard = (): Promise<void> =>
    releaseRerollGuard(deps.redis, record.rowId, record.attemptId);
  if (verdict === 'settled' || verdict === 'dropped') {
    // Nothing else will act for the dead attempt, so its row guard goes too
    // (the row is rerollable again without waiting out the TTL).
    await releaseGuard();
    return verdict;
  }
  if (inflightRemainingMs(record) <= 0) {
    // Counted from the record's creation, not from each write-back: it must not
    // outlive the reroll it describes however often it is retried or restarted.
    logger.error(
      { jobId: record.jobId, rowId: record.rowId },
      'Reroll recovery gave up: the record is past its original expiry'
    );
    await releaseGuard();
    return 'dropped';
  }
  // Written back under this process so a crash during the backoff leaves a
  // record the next boot can claim, and so this process's own retry (which
  // claims by this boot id) is the only taker meanwhile.
  await writeInflight(deps.redis, { ...record, bootId: deps.bootId });
  if (guard.acquired) {
    // The row must not answer "already rerolling" for the 40-minute guard TTL
    // after a pass that did not settle; a guard the dead attempt left in place
    // (not acquired here) stays for the live handler it may still belong to.
    await releaseGuard();
  }
  const lastDelay = RECOVERY_RETRY_DELAYS_MS.length - 1;
  if (verdict === 'held') {
    // Another attempt owns the row: waiting for it costs no try.
    deps.schedule(
      () => retry(record.jobId, deps, tries),
      RECOVERY_RETRY_DELAYS_MS[Math.min(tries, lastDelay)]
    );
  } else if (tries < RECOVERY_RETRY_DELAYS_MS.length) {
    deps.schedule(() => retry(record.jobId, deps, tries + 1), RECOVERY_RETRY_DELAYS_MS[tries]);
  } else {
    logger.error(
      { jobId: record.jobId, rowId: record.rowId },
      'Reroll recovery gave up; the record is left to its TTL and the next boot'
    );
    await releaseGuard();
  }
  return 'retry';
}

async function retry(jobId: string, deps: Resolved, tries: number): Promise<void> {
  const claimed = await claimInflight(deps.redis, jobId, r => r.bootId === deps.bootId);
  if (claimed !== null) {
    await settle(claimed, deps, tries);
  }
}

/**
 * Claim a record another process wrote, once it is old enough that no live
 * handler of an overlapping old process can still own it. A younger one is left
 * exactly as written; the periodic rescan sees it again once it has aged.
 */
async function claimOldForeign(
  deps: Resolved,
  jobId: string
): Promise<RerollInflightRecord | null> {
  const peeked = await peekInflight(deps.redis, jobId);
  if (peeked === null || peeked.bootId === deps.bootId) {
    return null;
  }
  if (Date.now() - peeked.writtenAt < REROLL_INFLIGHT_MIN_AGE_MS) {
    return null;
  }
  return claimInflight(
    deps.redis,
    jobId,
    r => r.bootId !== deps.bootId && Date.now() - r.writtenAt >= REROLL_INFLIGHT_MIN_AGE_MS
  );
}

/**
 * A live handler is keeping its in-flight record (its restore failed, or its
 * abort could not say whether the commit landed): have this process's retry
 * timer settle it after the first backoff, rather than leaving it to the next
 * boot, which may be past the record's TTL.
 */
export function handOffToRecovery(deps: RerollRecoveryDeps, jobId: string): void {
  const resolved: Resolved = {
    client: deps.client,
    redis: deps.redis,
    schedule: deps.schedule ?? defaultSchedule,
    bootId: deps.bootId ?? REROLL_BOOT_ID,
  };
  resolved.schedule(() => retry(jobId, resolved, 1), RECOVERY_RETRY_DELAYS_MS[0]);
}

/**
 * Run the recovery pass again every `REROLL_RECOVERY_RESCAN_MS`, for as long as
 * the process lives, so a record an overlapping old process writes (or has
 * claimed out) after one pass is picked up by a later one. Each pass is
 * idempotent and age-gated, and the next is scheduled only after the previous
 * one ends, so passes never overlap each other. The timers are unref'd.
 *
 * A timer, not a BullMQ repeatable (`01-architecture.md` § Timer Patterns
 * prefers one for scaling): the work is process-local (it reads this
 * process's Discord client) and bot-client is one Discord-bound process;
 * `createIntervalScheduler` documents the same single-instance reasoning.
 * Never throws.
 */
export function startRerollRecoveryRescan(deps: RerollRecoveryDeps): void {
  const schedule = deps.schedule ?? defaultSchedule;
  const rescan = async (): Promise<void> => {
    try {
      await runRerollRecovery(deps);
    } catch (err) {
      logger.warn({ err }, 'Reroll recovery rescan failed');
    }
    schedule(rescan, REROLL_RECOVERY_RESCAN_MS);
  };
  schedule(rescan, REROLL_RECOVERY_RESCAN_MS);
}

/**
 * Settle every reroll record a previous process left. Records written by this
 * process (live handlers) are never touched. Returns after the first pass over
 * each record; retries run later on timers. Never throws.
 */
export async function runRerollRecovery(deps: RerollRecoveryDeps): Promise<RerollRecoveryStats> {
  const resolved: Resolved = {
    client: deps.client,
    redis: deps.redis,
    schedule: deps.schedule ?? defaultSchedule,
    bootId: deps.bootId ?? REROLL_BOOT_ID,
  };
  const stats: RerollRecoveryStats = {
    scanned: 0,
    claimed: 0,
    settled: 0,
    dropped: 0,
    retrying: 0,
  };
  const jobIds = await scanInflightJobIds(deps.redis);
  stats.scanned = jobIds.length;
  for (const jobId of jobIds) {
    const record = await claimOldForeign(resolved, jobId);
    if (record === null) {
      continue;
    }
    stats.claimed += 1;
    const verdict = await settle(record, resolved, 0);
    if (verdict === 'settled') {
      stats.settled += 1;
    } else if (verdict === 'dropped') {
      stats.dropped += 1;
    } else {
      stats.retrying += 1;
    }
  }
  return stats;
}
