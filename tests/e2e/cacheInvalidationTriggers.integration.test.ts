/**
 * Cache-invalidation trigger chain — real Postgres, real NOTIFY.
 *
 * Exercises the full chain end to end:
 *   database trigger → NOTIFY 'cache_invalidation' → DatabaseNotificationListener
 *   → CacheInvalidationService.publish()
 *
 * Only the tail is stubbed: `publish()` records the events it is handed. The
 * trigger function, the NOTIFY, the LISTEN, and the listener's JSON parse +
 * `isValidInvalidationEvent` validation all run for real.
 *
 * Why this tier and not component: the writes happen on a SEPARATE pg
 * connection from the listener's, so the notification genuinely crosses
 * connections. PGLite (the component tier's database) is single-connection, and
 * its schema dump notes that the trigger's `pg_notify` calls are listener-less
 * no-ops there — the triggers exist, but nothing can observe the delivery.
 */

import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CacheInvalidationService } from '@tzurot/cache-invalidation';
import { DatabaseNotificationListener } from '../../services/api-gateway/src/services/DatabaseNotificationListener.js';

/**
 * Shape the trigger emits. The listener's own event union is not exported, so
 * this is declared locally — but declared NARROW on purpose: with `type: string`
 * a typo like 'personalty' in any of the comparisons below would type-check and
 * silently never match.
 */
interface RecordedEvent {
  type: 'personality' | 'all';
  personalityId?: string;
}

const DATABASE_URL = process.env.DATABASE_URL ?? '';

/**
 * Refuse to run against anything but a dedicated test database.
 *
 * This suite seeds and deletes rows in users, personas, personalities,
 * llm_configs, personality_default_configs and user_personality_configs, and
 * its UPDATEs fire the REAL trigger. NOTIFY fans out to every listener on the
 * channel, not just the one this file creates — so pointed at dev, an
 * llm_configs update would emit a genuine {type:'all'} invalidation to a
 * running api-gateway. And a run killed mid-flight (Ctrl-C, CI timeout) skips
 * afterAll, leaving fixture rows behind in whatever database was named.
 *
 * A comment cannot prevent an exported DATABASE_URL from a dev shell, so the
 * database NAME must end in `_test`: CI's tzurot_test and the local
 * tzurot_integration_test qualify; the dev `tzurot` database does not.
 */
function assertDedicatedTestDatabase(url: string): void {
  let databaseName: string;
  try {
    databaseName = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error(`DATABASE_URL is not a parseable URL, so its database name cannot be checked.`);
  }
  if (!/_test$/.test(databaseName)) {
    throw new Error(
      `Refusing to run: DATABASE_URL names the database "${databaseName}", which does not end in ` +
        `"_test". This suite mutates rows and fires real cache-invalidation NOTIFYs, so it must ` +
        `point at a dedicated test database (CI uses tzurot_test; locally, tzurot_integration_test).`
    );
  }
}

/** Fixture ids, generated once so cleanup can target exactly what we inserted. */
const userId = randomUUID();
const personaId = randomUUID();
const personalityId = randomUUID();
/**
 * A second personality nothing in these tests updates. It exists so the
 * "exactly one personality event" assertion is falsifiable: a trigger that
 * fanned out across personalities instead of naming the changed row would
 * emit an event for this one too.
 */
const bystanderPersonalityId = randomUUID();
const llmConfigId = randomUUID();

/** A discord id must fit varchar(20); a uuid does not. */
// Digits pulled from a uuid rather than Date.now(): two runs starting in the
// same millisecond would otherwise collide on the users.discord_id unique
// constraint, and that surfaces as a confusing constraint violation rather than
// as a designed failure like the guards above.
const discordId = `9${randomUUID().replace(/\D/g, '').padEnd(18, '0').slice(0, 18)}`;

// Both stay undefined when the DATABASE_URL guard throws out of beforeAll,
// which is why teardown checks each one before using it.
let writer: Client | undefined;
let listener: DatabaseNotificationListener | undefined;
const received: RecordedEvent[] = [];

/** The writer connection, once beforeAll has established it. */
function db(): Client {
  if (writer === undefined) {
    throw new Error('writer connection was never established');
  }
  return writer;
}

/**
 * Poll until `predicate` finds a matching event, then return it.
 *
 * NOTIFY delivery is asynchronous and the integration config disables fake
 * timers, so this is a real bounded wait. `expect.poll` owns the interval and
 * the deadline — a hand-rolled sleep loop would be a literal wall-clock delay,
 * which the shared test lint rule bans.
 */
async function waitForEvent(
  predicate: (event: RecordedEvent) => boolean,
  description: string,
  timeoutMs = 5000
): Promise<RecordedEvent> {
  // The polled value carries `description` and the buffer so a CI failure names
  // what was awaited and what arrived instead; a bare boolean would report only
  // "expected false to be true".
  await expect
    .poll(
      () =>
        received.some(predicate)
          ? 'matched'
          : `still waiting for ${description}; received so far: ${JSON.stringify(received)}`,
      { timeout: timeoutMs, interval: 25 }
    )
    .toBe('matched');
  const match = received.find(predicate);
  if (match === undefined) {
    throw new Error(`No event matching ${description} after poll reported success`);
  }
  return match;
}

async function seedFixtures(): Promise<void> {
  // users.default_persona_id and personas.owner_id reference each other, so the
  // pair only inserts inside a transaction with the (DEFERRABLE) FKs deferred.
  await db().query('BEGIN');
  await db().query('SET CONSTRAINTS ALL DEFERRED');
  await db().query(
    `INSERT INTO users (id, discord_id, username, default_persona_id, updated_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [userId, discordId, 'cache-invalidation-trigger-fixture', personaId]
  );
  await db().query(
    `INSERT INTO personas (id, name, content, owner_id, updated_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [personaId, `trigger-fixture-${personaId}`, 'fixture persona', userId]
  );
  await db().query('COMMIT');

  await db().query(
    `INSERT INTO personalities
       (id, name, slug, character_info, personality_traits, owner_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW()), ($7, $8, $9, $4, $5, $6, NOW())`,
    [
      personalityId,
      'Trigger Fixture',
      `trigger-fixture-${personalityId}`,
      'fixture character info',
      'fixture traits',
      userId,
      bystanderPersonalityId,
      'Trigger Fixture Bystander',
      `trigger-fixture-${bystanderPersonalityId}`,
    ]
  );

  await db().query(
    `INSERT INTO llm_configs (id, name, owner_id, model, updated_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [llmConfigId, `trigger-fixture-${llmConfigId}`, userId, 'fixture/model']
  );
}

async function cleanupFixtures(): Promise<void> {
  // A failed seed leaves this connection in Postgres's aborted-transaction
  // state (seedFixtures opens a transaction for the circular-FK pair), where
  // every statement below would fail with "current transaction is aborted" —
  // burying the real seeding error under a second, unrelated-looking one. The
  // ROLLBACK is a no-op outside a transaction, so it costs nothing normally.
  await db().query('ROLLBACK');

  // Every row here would in fact disappear by cascade from the llm_configs /
  // personalities / users deletes alone (personality_default_configs cascades
  // from both its parents, personas from users). The explicit deletes are
  // belt-and-braces so a future FK change cannot silently leave fixtures behind.
  await db().query('DELETE FROM user_personality_configs WHERE personality_id = $1', [
    personalityId,
  ]);
  await db().query('DELETE FROM personality_default_configs WHERE personality_id = $1', [
    personalityId,
  ]);
  await db().query('DELETE FROM llm_configs WHERE id = $1', [llmConfigId]);
  await db().query('DELETE FROM personalities WHERE id = ANY($1::uuid[])', [
    [personalityId, bystanderPersonalityId],
  ]);
  await db().query('BEGIN');
  await db().query('SET CONSTRAINTS ALL DEFERRED');
  await db().query('DELETE FROM users WHERE id = $1', [userId]);
  await db().query('DELETE FROM personas WHERE id = $1', [personaId]);
  await db().query('COMMIT');
}

// The guard's whole job is refusing a run, so its REJECT branches are the ones
// that matter — and only its accept path is exercised by the suite below. These
// call it directly, outside any database connection.
describe('assertDedicatedTestDatabase', () => {
  it('accepts the database names CI and local provisioning actually use', () => {
    expect(() =>
      assertDedicatedTestDatabase('postgresql://u:p@localhost:5432/tzurot_test')
    ).not.toThrow();
    expect(() =>
      assertDedicatedTestDatabase('postgresql://u:p@localhost:5432/tzurot_integration_test')
    ).not.toThrow();
  });

  it('refuses the dev database, naming it', () => {
    expect(() => assertDedicatedTestDatabase('postgresql://u:p@localhost:5432/tzurot')).toThrow(
      /"tzurot".*does not end in/s
    );
  });

  it('refuses a name that merely contains test without ending in _test', () => {
    expect(() =>
      assertDedicatedTestDatabase('postgresql://u:p@localhost:5432/test_fixtures')
    ).toThrow(/does not end in/);
  });

  it('refuses an unparseable URL rather than skipping the check', () => {
    expect(() => assertDedicatedTestDatabase('not-a-url')).toThrow(/not a parseable URL/);
  });
});

describe('cache-invalidation trigger chain (real Postgres NOTIFY)', () => {
  beforeAll(async () => {
    if (DATABASE_URL === '') {
      throw new Error(
        'DATABASE_URL is unset. This tier needs a real, migrated Postgres — never the dev ' +
          'database, since it seeds and mutates rows. See vitest.integration.config.ts for the ' +
          'one-time provisioning commands, then export DATABASE_URL for the run.'
      );
    }

    assertDedicatedTestDatabase(DATABASE_URL);

    writer = new Client({ connectionString: DATABASE_URL });
    await writer.connect();
    await seedFixtures();

    const stubCacheInvalidationService = {
      publish: (event: RecordedEvent): Promise<void> => {
        received.push(event);
        return Promise.resolve();
      },
      // publish() is the only member the listener touches on this collaborator
      // — verified at its single call site in
      // DatabaseNotificationListener.handleNotification. The cast narrows the
      // stub to the interface without pulling in a Redis connection.
    } as unknown as CacheInvalidationService;

    listener = new DatabaseNotificationListener(DATABASE_URL, stubCacheInvalidationService);
    // Trust boundary worth naming: start() does NOT reject on a failed
    // connection — it logs and schedules a reconnect — so this resolving is not
    // proof the LISTEN is live. If it were not, the failure would surface as a
    // waitForEvent timeout ("received so far: []"), which reads as flakiness
    // rather than as a connection problem. Accepted here because the CI job has
    // already proven connectivity twice by this point (the service's pg_isready
    // health check, then a successful `prisma migrate deploy`), and locally the
    // writer connection above would have thrown first.
    await listener.start();
  });

  afterAll(async () => {
    // afterAll still runs when beforeAll threw, and the DATABASE_URL guard
    // throws before either of these is assigned — so an unguarded teardown
    // raises a second, unrelated-looking TypeError that buries the actionable
    // message the guard exists to print. Each cleanup is conditional on the
    // thing it cleans up.
    if (listener !== undefined) {
      // The listener holds an open pg Client; without stop() the suite hangs.
      await listener.stop();
    }
    if (writer !== undefined) {
      // try/finally, not two awaits: if cleanupFixtures throws, end() must
      // still run or the connection leaks and the suite can hang. Client.end()
      // is safe mid-transaction — Postgres rolls back on close.
      try {
        await cleanupFixtures();
      } finally {
        await writer.end();
      }
    }
  });

  afterEach(() => {
    received.length = 0;
  });

  it('emits a personality event when a personality row bumps updated_at', async () => {
    await db().query(
      'UPDATE personalities SET display_name = $2, updated_at = NOW() WHERE id = $1',
      [personalityId, 'Renamed Fixture']
    );

    const matches = (e: RecordedEvent): boolean =>
      e.type === 'personality' && e.personalityId === personalityId;
    const event = await waitForEvent(matches, 'a personality event for the updated personality');
    expect(event).toEqual({ type: 'personality', personalityId });

    // The event names the changed row and NOBODY ELSE — the shape this trigger
    // function got wrong once was fanning out across personalities instead of
    // naming one. `bystanderPersonalityId` is seeded and never touched, so a
    // fan-out shows up here as a second personality event.
    //
    // Two things this assertion deliberately does NOT try to catch. A same-row
    // double-fire is unobservable: Postgres collapses duplicate identical
    // (channel, payload) notifications within a transaction — probed directly,
    // two identical pg_notify calls in one transaction deliver once — so an
    // assertion for it could never fail. And counting straight after the poll
    // would be a race, since the poll returns on the FIRST match while a
    // sibling event may still be in flight. Hence the fence: issue an unrelated
    // write and wait for ITS event. A single LISTEN connection receives
    // notifications in commit order, so once the fence event arrives every
    // notification from the earlier commit has already been delivered.
    await db().query('UPDATE llm_configs SET model = $2, updated_at = NOW() WHERE id = $1', [
      llmConfigId,
      'fence/after-personality-update',
    ]);
    await waitForEvent(e => e.type === 'all', 'the fence event after the personality update');
    expect(received.filter(e => e.type === 'personality')).toHaveLength(1);
  });

  it('emits a single "all" event when an llm_config row bumps updated_at', async () => {
    await db().query('UPDATE llm_configs SET model = $2, updated_at = NOW() WHERE id = $1', [
      llmConfigId,
      'fixture/model-v2',
    ]);

    const event = await waitForEvent(
      e => e.type === 'all',
      'an "all" event for the updated llm_config'
    );
    expect(event).toEqual({ type: 'all' });
    // The llm_configs branch returns early by design rather than fanning out
    // one event per personality.
    expect(received.filter(e => e.type === 'personality')).toEqual([]);
  });

  it('emits a personality event when a personality_default_configs row is inserted', async () => {
    await db().query(
      `INSERT INTO personality_default_configs (personality_id, llm_config_id, updated_at)
       VALUES ($1, $2, NOW())`,
      [personalityId, llmConfigId]
    );

    const event = await waitForEvent(
      e => e.type === 'personality' && e.personalityId === personalityId,
      'a personality event for the inserted default-config row'
    );
    expect(event).toEqual({ type: 'personality', personalityId });
  });

  it('emits a personality event when a personality_default_configs row is deleted', async () => {
    // personality_id is the PK, so the preceding insert test leaves a row this
    // one would collide with. The ON CONFLICT makes this test correct whether
    // or not that test ran — it TOLERATES the leftover rather than depending on
    // it, which is what keeps the case self-contained per Core Principle 6.
    await db().query(
      `INSERT INTO personality_default_configs (personality_id, llm_config_id, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (personality_id) DO UPDATE SET llm_config_id = EXCLUDED.llm_config_id`,
      [personalityId, llmConfigId]
    );
    await waitForEvent(
      e => e.type === 'personality' && e.personalityId === personalityId,
      'the insert/upsert event to settle before the delete'
    );
    received.length = 0;

    await db().query('DELETE FROM personality_default_configs WHERE personality_id = $1', [
      personalityId,
    ]);

    const event = await waitForEvent(
      e => e.type === 'personality' && e.personalityId === personalityId,
      'a personality event for the deleted default-config row'
    );
    expect(event).toEqual({ type: 'personality', personalityId });
  });

  // The fourth branch of the same trigger function. Structurally identical to
  // personality_default_configs (INSERT/UPDATE/DELETE, personality_id via
  // COALESCE(NEW, OLD)) but on its own table with its own trigger, so nothing
  // the cases above prove covers it.
  it('emits a personality event when a user_personality_configs row is inserted', async () => {
    await db().query(
      `INSERT INTO user_personality_configs (id, user_id, personality_id, llm_config_id, updated_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [randomUUID(), userId, personalityId, llmConfigId]
    );

    const event = await waitForEvent(
      e => e.type === 'personality' && e.personalityId === personalityId,
      'a personality event for the inserted user-personality config'
    );
    expect(event).toEqual({ type: 'personality', personalityId });
  });
});
