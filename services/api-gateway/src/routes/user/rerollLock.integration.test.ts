/**
 * The reroll row lock, proven on two real connections.
 *
 * Commit and abort both `SELECT … FOR UPDATE` the OLD history row before they
 * decide anything. The component tier cannot show that: PGLite is a single
 * in-process connection, so a second transaction can never wait on a first
 * (the cache-invalidation integration test records the same limit). Here one
 * raw connection plays the competing transaction and holds the lock open while
 * the real route code runs on the Prisma pool; the assertions are
 *
 *  - from `pg_stat_activity` / `pg_blocking_pids`: the route's backend is
 *    waiting on the holder's backend (polled to a bounded deadline, no sleeps);
 *  - from the outcome: the route decided AFTER the holder committed. Under
 *    READ COMMITTED without the lock it would have read the pre-commit state
 *    and answered differently, so a missing lock fails these tests.
 *
 * Needs a real migrated Postgres (CI provides one); never run locally. See
 * vitest.integration.config.ts.
 */

import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createPrismaClient } from '@tzurot/common-types/services/prisma';
import { generateRerolledConversationHistoryUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { assertLaneIntegrationDb } from '@tzurot/test-utils/testLane';
import type { RouteDeps } from '../routeDeps.js';
import { handleRerollAssistantMessage } from './historyReroll.js';
import { REROLL_TRANSACTION_TIMEOUT_MS, abortRerollAttempt } from './rerollAttempt.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';

const userId = randomUUID();
const personaId = randomUUID();
const personalityId = randomUUID();
const oldRowId = randomUUID();
const memoryId = randomUUID();
const discordId = `9${randomUUID().replace(/\D/g, '').padEnd(18, '0').slice(0, 18)}`;
const channelId = `8${randomUUID().replace(/\D/g, '').padEnd(18, '0').slice(0, 18)}`;
const oldMessageId = `7${randomUUID().replace(/\D/g, '').padEnd(18, '0').slice(0, 18)}`;
const ATTEMPT_ID = 'lock-test-attempt';
const JOB_ID = 'lock-test-job';
const newRowId = generateRerolledConversationHistoryUuid(oldRowId, ATTEMPT_ID);

/**
 * Locked-up connections wait this long at most before the test fails (polling
 * deadline). Half the route transactions' timeout: the poll must give up (and
 * say so) before the waiter's own transaction expires underneath it.
 */
const BLOCKED_DEADLINE_MS = REROLL_TRANSACTION_TIMEOUT_MS / 2;

let holder: Client | undefined;
let monitor: Client | undefined;
let handle: ReturnType<typeof createPrismaClient> | undefined;

/** A resource beforeAll established; its absence means beforeAll threw first. */
function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`${name} was never established`);
  }
  return value;
}

const conn = (client: Client | undefined): Client => need(client, 'connection');
const prismaOf = (): RouteDeps['prisma'] => need(handle, 'prisma').prisma as RouteDeps['prisma'];

async function seed(): Promise<void> {
  const db = conn(monitor);
  // users.default_persona_id and personas.owner_id reference each other.
  await db.query('BEGIN');
  await db.query('SET CONSTRAINTS ALL DEFERRED');
  await db.query(
    `INSERT INTO users (id, discord_id, username, default_persona_id, updated_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [userId, discordId, 'reroll-lock-fixture', personaId]
  );
  await db.query(
    `INSERT INTO personas (id, name, content, owner_id, updated_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [personaId, `reroll-lock-${personaId}`, 'fixture persona', userId]
  );
  await db.query('COMMIT');
  await db.query(
    `INSERT INTO personalities
       (id, name, slug, character_info, personality_traits, owner_id, updated_at)
     VALUES ($1, $2, $3, 'fixture', 'fixture', $4, NOW())`,
    [personalityId, 'Reroll Lock Fixture', `reroll-lock-${personalityId}`, userId]
  );
  await db.query(
    `INSERT INTO conversation_history
       (id, channel_id, personality_id, persona_id, role, content, discord_message_id, updated_at)
     VALUES ($1, $2, $3, $4, 'assistant', 'OLD', ARRAY[$5]::text[], NOW())`,
    [oldRowId, channelId, personalityId, personaId, oldMessageId]
  );
  await db.query(
    `INSERT INTO memories (id, persona_id, personality_id, content, message_ids, senders, updated_at)
     VALUES ($1, $2, $3, '{user}: hi\n{assistant}: NEW', ARRAY[]::text[], ARRAY['fixture']::text[], NOW())`,
    [memoryId, personaId, personalityId]
  );
}

async function cleanup(): Promise<void> {
  const db = conn(monitor);
  await db.query('ROLLBACK');
  await db.query('DELETE FROM memories WHERE id = $1', [memoryId]);
  await db.query('DELETE FROM job_results WHERE job_id = $1', [JOB_ID]);
  await db.query('DELETE FROM conversation_history WHERE id = ANY($1::uuid[])', [
    [oldRowId, newRowId],
  ]);
  await db.query('DELETE FROM personalities WHERE id = $1', [personalityId]);
  await db.query('BEGIN');
  await db.query('SET CONSTRAINTS ALL DEFERRED');
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await db.query('DELETE FROM personas WHERE id = $1', [personaId]);
  await db.query('COMMIT');
}

/** Take the old row's lock on the holder connection and keep the transaction open. */
async function holdRowLock(): Promise<number> {
  const db = conn(holder);
  await db.query('BEGIN');
  await db.query('SELECT id FROM conversation_history WHERE id = $1 FOR UPDATE', [oldRowId]);
  const pid = await db.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
  return pid.rows[0].pid;
}

/**
 * Poll until a backend running a `FOR UPDATE` statement is blocked by the
 * holder's backend. `expect.poll` owns the interval and the deadline.
 */
async function waitUntilBlockedBy(holderPid: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const blocked = await conn(monitor).query(
          `SELECT pid FROM pg_stat_activity
           WHERE datname = current_database()
             AND $1::int = ANY(pg_blocking_pids(pid))
             AND query ILIKE '%FOR UPDATE%'`,
          [holderPid]
        );
        return blocked.rowCount ?? 0;
      },
      { timeout: BLOCKED_DEADLINE_MS, interval: 25 }
    )
    .toBeGreaterThan(0);
}

async function memoryVisibility(): Promise<string | undefined> {
  const rows = await conn(monitor).query<{ visibility: string }>(
    'SELECT visibility FROM memories WHERE id = $1',
    [memoryId]
  );
  return rows.rows.at(0)?.visibility;
}

describe('reroll row lock (real Postgres, two connections)', () => {
  beforeAll(async () => {
    if (DATABASE_URL === '') {
      throw new Error(
        'DATABASE_URL is unset. This tier needs a real, migrated Postgres — never the dev ' +
          'database, since it seeds and mutates rows. See vitest.integration.config.ts.'
      );
    }
    assertLaneIntegrationDb(DATABASE_URL);

    monitor = new Client({ connectionString: DATABASE_URL });
    holder = new Client({ connectionString: DATABASE_URL });
    await monitor.connect();
    await holder.connect();
    // The production pool carries a short lock_timeout (a 55P03 names a stuck
    // lock); disabled here so the wait is bounded by this test's own deadline
    // and a slow CI box cannot turn a correct wait into a lock-timeout failure.
    handle = createPrismaClient({ max: 2, poolOverrides: { options: '-c lock_timeout=0' } });
    await seed();
  });

  afterEach(async () => {
    // A failed test may leave the holder's transaction open, which would block cleanup.
    await conn(holder).query('ROLLBACK');
    await cleanup();
    await seed();
  });

  afterAll(async () => {
    if (monitor !== undefined && holder !== undefined) {
      await conn(holder).query('ROLLBACK');
      await cleanup();
    }
    await handle?.dispose();
    await holder?.end();
    await monitor?.end();
  });

  it('an abort waits for a commit that holds the lock, then reports committed and removes nothing', async () => {
    const holderPid = await holdRowLock();
    // The competing commit: old row soft-deleted, the attempt's new row in place.
    await conn(holder).query('UPDATE conversation_history SET deleted_at = NOW() WHERE id = $1', [
      oldRowId,
    ]);
    await conn(holder).query(
      `INSERT INTO conversation_history
         (id, channel_id, personality_id, persona_id, role, content, discord_message_id, updated_at)
       VALUES ($1, $2, $3, $4, 'assistant', 'NEW', ARRAY[$5]::text[], NOW())`,
      [newRowId, channelId, personalityId, personaId, oldMessageId]
    );

    const aborting = abortRerollAttempt({
      prisma: prismaOf(),
      rowId: oldRowId,
      attemptId: ATTEMPT_ID,
      jobId: JOB_ID,
      ownerScope: { persona: { ownerId: userId } },
      row: { personaId, personalityId, ownerId: userId },
      newMemoryIds: [memoryId],
      newPendingIds: [],
      keepMemoryIds: [],
    });
    // A branch that swallows a rejection, so a failed poll below cannot leave
    // this promise to reject unhandled; the awaits further down still see it.
    aborting.catch(() => undefined);
    await waitUntilBlockedBy(holderPid);
    // Still waiting: nothing has been removed while the holder owns the row.
    expect(await memoryVisibility()).toBe('normal');

    await conn(holder).query('COMMIT');
    const result = await aborting;

    expect(result).toEqual({
      committed: true,
      removedMemories: 0,
      oldRowLive: false,
      oldRowContentDigest: null,
    });
    expect(await memoryVisibility()).toBe('normal');
  });

  it('a commit waits for an abort that holds the lock, then refuses on the tombstone', async () => {
    const holderPid = await holdRowLock();
    // The competing abort: the attempt tombstoned on the old row.
    await conn(holder).query(
      `UPDATE conversation_history
       SET message_metadata = jsonb_build_object('abortedRerollAttempts', jsonb_build_array($2::text))
       WHERE id = $1`,
      [oldRowId, ATTEMPT_ID]
    );

    const json = vi.fn().mockReturnThis();
    const status = vi.fn().mockReturnThis();
    const committing = handleRerollAssistantMessage({ prisma: prismaOf() } as RouteDeps)(
      {
        userId: discordId,
        params: { messageId: oldMessageId },
        query: {},
        body: {
          rowId: oldRowId,
          attemptId: ATTEMPT_ID,
          jobId: JOB_ID,
          content: 'NEW',
          discordMessageIds: [oldMessageId],
          newMemoryIds: [],
          newPendingIds: [],
        },
      } as unknown as Request,
      { status, json } as unknown as Response,
      () => undefined
    );
    // `asyncHandler` types its return as unknown; it is the handler's promise.
    Promise.resolve(committing).catch(() => undefined);
    await waitUntilBlockedBy(holderPid);
    expect(status).not.toHaveBeenCalled();

    await conn(holder).query('COMMIT');
    await committing;

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ATTEMPT_ABORTED' }));
    const created = await conn(monitor).query('SELECT id FROM conversation_history WHERE id = $1', [
      newRowId,
    ]);
    expect(created.rowCount).toBe(0);
  });
});
