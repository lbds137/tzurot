/**
 * Internal route manifest — retention routes (Phase 2-4).
 *
 * Split out of internal.ts purely for the max-lines budget; semantically
 * this is part of the one internal manifest, and `internalRoutes` in
 * internal.ts merges it back in. Mirrors the `routes/user/` split's
 * rationale (see that directory's `index.ts`).
 *
 * Audience invariant: every entry below has `audience: 'internal'` and
 * `serviceOnly: true`, same as the rest of the internal manifest.
 */

import {
  RetentionPreviewResponseSchema,
  RetentionRunBeginRequestSchema,
  RetentionRunBeginResponseSchema,
  RetentionRunEndRequestSchema,
  RetentionRunEndResponseSchema,
  RetentionPurgeRequestSchema,
  RetentionPurgeResponseSchema,
  RetentionReconcileOffDbResponseSchema,
  RetentionNotifyRequestSchema,
  RetentionNotifyResponseSchema,
  RetentionNotifyFilterRequestSchema,
  RetentionNotifyFilterResponseSchema,
  RetentionNotifyReportRequestSchema,
  RetentionNotifyReportResponseSchema,
} from '@tzurot/common-types/schemas/api/internal';

import type { RouteDef } from './types.js';

/**
 * Client timeout for one per-account purge. The erasure transaction it waits
 * on has its own 60s budget (AccountDeletionService's DELETION_TX_TIMEOUT_MS),
 * so the 20s WRITE default aborts a slow purge the gateway still commits —
 * the caller would report a failure for an account that is gone. 60s is the
 * manifest's cap for a route without a LONG_SYNC exemption. It matches the
 * transaction budget rather than outwaiting it: the pre-transaction checks and
 * the post-transaction off-DB cleanup can still push a worst-case call past it.
 */
const RETENTION_PURGE_TIMEOUT_MS = 60_000;

export const internalRetentionRoutes = {
  /**
   * GET /api/internal/retention/preview
   * The purge-eligible cohort (Retention Phase 2, D2/D3) with per-user
   * character impact and the circuit-breaker annotation. READ-ONLY — it
   * reports; the purge is a separate endpoint. Consumed by the
   * `pnpm ops retention:preview` CLI and bot-client's daily retention job (its
   * live run, nag, and rehearsal modes), all reading the same predicate so
   * their counts can never drift.
   */
  retentionPreview: {
    audience: 'internal',
    method: 'get',
    path: '/retention/preview',
    id: 'retentionPreview',
    output: RetentionPreviewResponseSchema,
    serviceOnly: true,
    meta: { safeRead: true },
  },

  /**
   * POST /api/internal/retention/run/begin
   * Take the retention run lease (Phase 4). Serializes whole retention RUNS
   * across the many HTTP calls one run makes — one run at a time. A second
   * `begin` while a lease is held answers 409 with subcode RUN_IN_PROGRESS,
   * naming the holder's run context and since-when. The purge/notify CLIs
   * call this after the preview and the operator's confirmation, so an
   * operator pondering the prompt never holds the lease; bot-client's daily
   * retention job calls it after its own pre-run preview.
   */
  retentionRunBegin: {
    audience: 'internal',
    method: 'post',
    path: '/retention/run/begin',
    id: 'retentionRunBegin',
    input: RetentionRunBeginRequestSchema,
    output: RetentionRunBeginResponseSchema,
    serviceOnly: true,
  },

  /**
   * POST /api/internal/retention/run/end
   * Release the retention run lease (Phase 4). Never releases another run's
   * lease — `released: false` reports a lease that was not this run's
   * (expired, or taken over by another run) rather than throwing.
   */
  retentionRunEnd: {
    audience: 'internal',
    method: 'post',
    path: '/retention/run/end',
    id: 'retentionRunEnd',
    input: RetentionRunEndRequestSchema,
    output: RetentionRunEndResponseSchema,
    serviceOnly: true,
  },

  /**
   * POST /api/internal/retention/purge
   * Erase ONE purge-eligible account (Retention Phase 2, D2). Per-user by
   * design: a whole-cohort call would exceed the platform request timeout
   * mid-run and leave a partial, unrecorded purge. Idempotent — an
   * already-purged or newly-active target returns 200 with a `skipped` status,
   * so a caller's loop (the CLI's or the daily job's) is safe to re-run after
   * any interruption. Eligibility is re-checked INSIDE the erasure
   * transaction, so a user who became active since the preview is never
   * erased. Requires the `runId` from `retention/run/begin`; the lease is
   * refreshed before the purge acts, and a run that has lost the lease gets
   * 409 RUN_LEASE_CONFLICT with no erasure. A target outside this
   * environment's purge scope (see purgeScope.ts) is skipped rather than
   * erased. Its client timeout is `RETENTION_PURGE_TIMEOUT_MS` (see that
   * constant for why it exceeds the WRITE default).
   */
  retentionPurge: {
    audience: 'internal',
    method: 'post',
    path: '/retention/purge',
    id: 'retentionPurge',
    input: RetentionPurgeRequestSchema,
    output: RetentionPurgeResponseSchema,
    serviceOnly: true,
    timeoutMs: RETENTION_PURGE_TIMEOUT_MS,
  },

  /**
   * POST /api/internal/retention/reconcile-off-db
   * Replay the off-DB cleanup (avatar unlink) owed by any purge-audit row whose
   * reconciliation did not complete (D15). The audit ledger doubles as the
   * retry queue, so this needs no input. Idempotent: a settled ledger is a
   * zero-row no-op, which is why the purge CLI and the daily job call it
   * after every run.
   */
  retentionReconcileOffDb: {
    audience: 'internal',
    method: 'post',
    path: '/retention/reconcile-off-db',
    id: 'retentionReconcileOffDb',
    output: RetentionReconcileOffDbResponseSchema,
    serviceOnly: true,
  },

  /**
   * POST /api/internal/retention/notify
   * Resolve the reachable-but-inactive cohort and enqueue warning-DM batches
   * (Phase 3). Two callers: the retention:notify CLI (behind its confirmation
   * prompt) and bot-client's daily retention job in production, which never
   * sends `breakerOverride`. Cross-run idempotent via the predicate itself.
   * A non-dry run requires the `runId` from `retention/run/begin` and is
   * refreshed against the run lease before it enqueues anything; dry runs
   * are read-only and stay unleased (no `runId` required).
   */
  retentionNotify: {
    audience: 'internal',
    method: 'post',
    path: '/retention/notify',
    id: 'retentionNotify',
    input: RetentionNotifyRequestSchema,
    output: RetentionNotifyResponseSchema,
    serviceOnly: true,
  },

  /**
   * POST /api/internal/retention/notify/filter
   * The worker's send-time still-eligible re-check: a user active since
   * cohort resolution must not be DMed a deletion warning.
   */
  retentionNotifyFilter: {
    audience: 'internal',
    method: 'post',
    path: '/retention/notify/filter',
    id: 'retentionNotifyFilter',
    input: RetentionNotifyFilterRequestSchema,
    output: RetentionNotifyFilterResponseSchema,
    serviceOnly: true,
  },

  /**
   * POST /api/internal/retention/notify/report
   * Per-recipient delivery outcomes: sent stamps the grace clock; a permanent
   * bounce stamps the unreachable column (the re-route to the purge branch).
   */
  retentionNotifyReport: {
    audience: 'internal',
    method: 'post',
    path: '/retention/notify/report',
    id: 'retentionNotifyReport',
    input: RetentionNotifyReportRequestSchema,
    output: RetentionNotifyReportResponseSchema,
    serviceOnly: true,
  },
} as const satisfies Record<string, RouteDef>;
