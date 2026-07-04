/**
 * Fast-pool DB-timeout classifier.
 *
 * The conversation-event persist writes run on a dedicated fast pool with a
 * STAGGERED finite-timeout ladder (`lock_timeout` < `statement_timeout` <
 * client `query_timeout`). When a persist fails, exactly one of those fires
 * first — so the failure is self-labeling: this classifier maps the error to
 * the cause so the prod log names it without a second investigation.
 *
 *  - lock wait                     → SQLSTATE `55P03` ("…due to lock timeout")
 *  - slow server work / GIN flush  → SQLSTATE `57014` ("…due to statement timeout")
 *  - dead/stale socket             → client-side `query_timeout` (server never saw it)
 *
 * Matches BOTH the SQLSTATE and the canonical Postgres message phrasing, because
 * the exact shape surfaced through `@prisma/adapter-pg` is version-dependent
 * (the raw driver error may be wrapped, nested under `.meta`, or chained on
 * `.cause`).
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';

const retryLogger = createLogger('fast-pool-retry');

export type DbTimeoutLabel =
  'lock-timeout' | 'statement-timeout' | 'query-timeout-or-dead-conn' | 'other';

export interface DbTimeoutClassification {
  label: DbTimeoutLabel;
  /** Postgres SQLSTATE when one was recoverable from the error chain. */
  sqlstate?: string;
}

/**
 * Pull the Postgres SQLSTATE from the places Prisma/pg stash the driver error.
 *
 * Prisma 7 + @prisma/adapter-pg does NOT put the SQLSTATE on `.code` — it puts
 * its OWN code there (e.g. `P2010` "raw query failed") and buries the real
 * SQLSTATE in the message: `Raw query failed. Code: \`57014\`. Message: \`…\``
 * (confirmed against the dev DB). So we (1) accept a real SQLSTATE on
 * `.code`/`.meta.code`/`.cause.code` only if it is NOT a Prisma `P####` code,
 * then (2) parse it out of the wrapped message.
 */
function extractSqlstate(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const e = error as Record<string, unknown>;
  const meta = e.meta as Record<string, unknown> | undefined;
  const cause = e.cause as Record<string, unknown> | undefined;
  for (const candidate of [e.code, meta?.code, cause?.code]) {
    if (
      typeof candidate === 'string' &&
      /^[0-9A-Z]{5}$/.test(candidate) &&
      !/^P\d{4}$/.test(candidate)
    ) {
      return candidate;
    }
  }
  const fromMessage = /code:\s*`?([0-9a-z]{5})`?/i.exec(errorText(error));
  return fromMessage !== null ? fromMessage[1].toUpperCase() : undefined;
}

/** Flatten message + code fields (incl. nested cause/meta) for substring matching. */
function errorText(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return String(error).toLowerCase();
  }
  const e = error as Record<string, unknown>;
  const meta = e.meta as Record<string, unknown> | undefined;
  const cause = e.cause as Record<string, unknown> | undefined;
  // Include `.code` values too: node-postgres socket errors (ETIMEDOUT,
  // ECONNRESET, EPIPE) surface the marker on `.code`, not always in the message.
  return [e.message, e.code, meta?.message, meta?.code, cause?.message, cause?.code]
    .filter((p): p is string => typeof p === 'string')
    .join(' | ')
    .toLowerCase();
}

/** Classify a fast-pool persist error into the timeout it hit (or `other`). */
export function classifyDbTimeout(error: unknown): DbTimeoutClassification {
  const sqlstate = extractSqlstate(error);
  const text = errorText(error);

  if (sqlstate === '55P03' || text.includes('due to lock timeout')) {
    return { label: 'lock-timeout', sqlstate: '55P03' };
  }
  if (sqlstate === '57014' || text.includes('due to statement timeout')) {
    return { label: 'statement-timeout', sqlstate: '57014' };
  }
  if (
    text.includes('query read timeout') ||
    text.includes('connection terminated') ||
    text.includes('econnreset') ||
    text.includes('etimedout') ||
    text.includes('epipe')
  ) {
    return { label: 'query-timeout-or-dead-conn' };
  }
  return sqlstate !== undefined ? { label: 'other', sqlstate } : { label: 'other' };
}

/**
 * Run a fast-pool persist, retrying ONCE if the first attempt fails with the
 * dead/stale-socket class (`query-timeout-or-dead-conn`).
 *
 * Safe + deterministic because `pg-pool` DESTROYS a connection on any query
 * error (its `_release` calls `_remove` when passed a truthy err), and
 * `@prisma/adapter-pg`'s non-transactional path runs through `pool.query()` —
 * so the dead socket is already evicted by the time we retry, and the second
 * attempt acquires a FRESH connection. The write is idempotent two ways, so the
 * retry is safe even if the classification is imperfect: (1) a dead-socket query
 * never reached the server, so nothing was persisted on the failed attempt; and
 * (2) in the ambiguous case where the socket died AFTER the INSERT committed, the
 * retry's `create` (deterministic UUID) hits `P2002`, which the caller's outer
 * catch already handles via its existence-compare fallback → a `matched` response.
 *
 * ONLY the dead-conn class is retried. A real `lock-timeout` / `statement-timeout`
 * (the query actually ran server-side) or any other error (`other`, e.g. a
 * constraint violation) re-throws immediately — retrying wouldn't help and could
 * duplicate work.
 */
export async function withDeadConnRetry<T>(
  op: () => Promise<T>,
  onRetry?: (error: unknown) => void
): Promise<T> {
  try {
    return await op();
  } catch (error) {
    if (classifyDbTimeout(error).label !== 'query-timeout-or-dead-conn') {
      throw error;
    }
    onRetry?.(error);
    return op();
  }
}

/**
 * Structural version of {@link withDeadConnRetry}: wrap a fast-pool `PrismaClient`
 * so EVERY operation on it retries once on the dead/stale-socket class — applied
 * at the client boundary instead of hand-wrapped per call site. This covers all
 * fast-pool consumers (the conversation-persist existence-check reads AND the
 * writes, plus any future fast-pool route) automatically, so the retry can't be
 * forgotten when a new call site is added.
 *
 * Safe to apply blanket ONLY because the fast pool is dedicated to idempotent
 * conversation-event persists by design (deterministic-UUID upsert-shaped writes
 * + pure reads). Do NOT reuse this on the main pool, where non-idempotent writes
 * would double-execute on retry.
 */
export function applyFastPoolDeadConnRetry(client: PrismaClient): PrismaClient {
  return client.$extends({
    query: {
      $allOperations: ({ model, operation, args, query }) =>
        withDeadConnRetry(
          () => query(args),
          error =>
            retryLogger.warn(
              { err: error, model, operation },
              'Fast-pool query hit a dead/stale connection — retrying once on a fresh socket'
            )
        ),
    },
    // $extends returns a structurally-compatible but differently-typed client;
    // the fast pool only ever runs the ops PrismaClient already exposes.
  }) as unknown as PrismaClient;
}
