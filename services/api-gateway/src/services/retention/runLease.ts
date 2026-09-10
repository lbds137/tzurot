/**
 * Retention run lease — serializes whole retention RUNS across the many HTTP
 * calls one run makes.
 *
 * A run is many requests (the purge is one account per call by design — see
 * RetentionPurgeService's header), so a Postgres session advisory lock cannot
 * span it on a pooled connection, and a per-call transaction lock would
 * serialize single purges but not runs: two interleaved runs could still
 * double-enqueue notify batches and race each other's per-call ceiling counts.
 * So the gateway holds a run-level lease in Redis: `run/begin` acquires it,
 * every leased call refreshes it before acting, and `run/end` releases it. The
 * TTL bounds how long a crashed run can block the next one.
 *
 * The runId is an ephemeral lease token (`randomUUID`), not a DB entity id —
 * the deterministic-id convention is for rows, and a lease token must NOT be
 * derivable by a second caller.
 *
 * Redis errors FAIL CLOSED (RunLeaseUnavailableError → the route answers 503),
 * the opposite of the house fail-open default for counters: this lease guards
 * account deletion, and a lock that opens when its store is down is no lock.
 */

import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

export const RUN_LEASE_KEY = 'retention:run-lease';

/**
 * How long a lease survives without a refresh. Every leased call refreshes it,
 * and one purge call is bounded by its ~60s erasure transaction, so 10 minutes
 * is a wide margin for a live run while still reclaiming a crashed run's lease
 * within one coffee break.
 */
export const RUN_LEASE_TTL_MS = 10 * 60 * 1000;

/** What a refused caller is told about the run in its way. */
export interface RunLeaseHolder {
  runContext: string;
  acquiredAt: string;
}

interface StoredLease extends RunLeaseHolder {
  runId: string;
}

export type AcquireResult =
  { acquired: true; runId: string } | { acquired: false; holder: RunLeaseHolder | null };

export type RefreshResult = { ok: true } | { ok: false; holder: RunLeaseHolder | null };

/** The Redis commands the lease uses — narrowed so a test double implements exactly these. */
export type RunLeaseRedis = Pick<Redis, 'set' | 'get' | 'pexpire' | 'del'>;

/** The lease store could not be reached; the caller must not assume it holds (or lacks) the lease. */
export class RunLeaseUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Retention run lease store (Redis) is unavailable', { cause });
    this.name = 'RunLeaseUnavailableError';
  }
}

type LeaseState =
  | { state: 'absent' }
  | { state: 'held'; lease: StoredLease }
  /** A value we cannot parse: treated as someone else's lease (fail closed). */
  | { state: 'unreadable' };

function parseStoredLease(raw: string): StoredLease | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const { runId, runContext, acquiredAt } = value as Record<string, unknown>;
    if (
      typeof runId !== 'string' ||
      typeof runContext !== 'string' ||
      typeof acquiredAt !== 'string'
    ) {
      return null;
    }
    return { runId, runContext, acquiredAt };
  } catch {
    return null;
  }
}

function holderOf(state: LeaseState): RunLeaseHolder | null {
  return state.state === 'held'
    ? { runContext: state.lease.runContext, acquiredAt: state.lease.acquiredAt }
    : null;
}

export class RunLease {
  constructor(
    private readonly redis: RunLeaseRedis,
    private readonly now: () => Date = () => new Date()
  ) {}

  /** Take the lease for a new run, or report who holds it. */
  async acquire(runContext: string): Promise<AcquireResult> {
    const runId = randomUUID();
    if (await this.setIfAbsent(runId, runContext)) {
      return { acquired: true, runId };
    }
    // The holder can be null if the lease expired between the SET and this
    // read, or its value is unreadable — the caller still must not proceed.
    return { acquired: false, holder: holderOf(await this.read()) };
  }

  /**
   * Keep this run's lease alive before a leased call acts. Our lease → extend
   * it. No lease at all (it expired and nobody took it) → re-establish it under
   * the SAME runId, so a run that paused past the TTL heals itself. Anyone
   * else's lease → conflict: this run has lost the lease and must stop.
   *
   * `runContext` labels a re-established lease for the next refused caller.
   *
   * GET-then-PEXPIRE is non-atomic, deliberately (no Lua — see 03-database.md
   * § Redis counters): the only race is our lease expiring in the instant
   * between the two commands AND another run acquiring in that window, in which
   * case this call proceeds while the other run also holds a fresh lease. That
   * is an accepted race, NOT covered by any test.
   */
  async refresh(runId: string, runContext: string): Promise<RefreshResult> {
    const current = await this.read();
    if (current.state === 'held' && current.lease.runId === runId) {
      const extended = await this.guard(() => this.redis.pexpire(RUN_LEASE_KEY, RUN_LEASE_TTL_MS));
      if (extended === 1) {
        return { ok: true };
      }
      // Expired between the GET and the PEXPIRE: fall through and re-establish.
    } else if (current.state !== 'absent') {
      return { ok: false, holder: holderOf(current) };
    }
    if (await this.setIfAbsent(runId, runContext)) {
      return { ok: true };
    }
    return { ok: false, holder: holderOf(await this.read()) };
  }

  /**
   * Release this run's lease. Returns false when the lease is not ours (already
   * expired, or taken by another run) — never deletes someone else's lease.
   * GET-then-DEL is non-atomic, and its race is worse than `refresh`'s: if
   * this run's lease expires and another run acquires it between the GET and
   * the DEL, the DEL deletes THAT run's live lease, and a third run could then
   * acquire while the second still believes it holds one. It needs this run to
   * have gone a full lease TTL without a refresh AND a competing acquire to
   * land in that gap, and no erasure depends on the lease for correctness
   * (every erasure re-checks eligibility inside its own transaction), so it is
   * accepted rather than closed with WATCH/MULTI or Lua. Not covered by any
   * test.
   */
  async release(runId: string): Promise<boolean> {
    const current = await this.read();
    if (current.state !== 'held' || current.lease.runId !== runId) {
      return false;
    }
    await this.guard(() => this.redis.del(RUN_LEASE_KEY));
    return true;
  }

  private async setIfAbsent(runId: string, runContext: string): Promise<boolean> {
    const lease: StoredLease = { runId, runContext, acquiredAt: this.now().toISOString() };
    const landed = await this.guard(() =>
      this.redis.set(RUN_LEASE_KEY, JSON.stringify(lease), 'PX', RUN_LEASE_TTL_MS, 'NX')
    );
    return landed === 'OK';
  }

  private async read(): Promise<LeaseState> {
    const raw = await this.guard(() => this.redis.get(RUN_LEASE_KEY));
    if (raw === null) {
      return { state: 'absent' };
    }
    const lease = parseStoredLease(raw);
    return lease === null ? { state: 'unreadable' } : { state: 'held', lease };
  }

  private async guard<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      // FAIL CLOSED: this lease guards account deletion, so an unreachable
      // store must stop the run (503), never read as "no lease held" — the
      // opposite of the fail-open counter default in 03-database.md.
      throw new RunLeaseUnavailableError(error);
    }
  }
}
