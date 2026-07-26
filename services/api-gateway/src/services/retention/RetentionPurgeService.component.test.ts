/**
 * Component test: the eligibility predicate over REAL PGLite. Seeds a user for
 * every arm of D4 — eligible via each unreachable signal, plus one excluded by
 * each exemption — and asserts the cohort is EXACTLY the eligible set.
 *
 * This is the load-bearing proof for the whole purge branch: every later phase
 * (nag, purge) reads this same predicate, so an over-inclusive predicate here
 * would eventually erase someone it shouldn't.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { generateUserUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { ORPHAN_SENTINEL_DISCORD_ID } from '@tzurot/common-types/constants/persona';
import { RetentionPurgeService } from './RetentionPurgeService.js';

const OLD = new Date('2020-01-01T00:00:00Z'); // far past the 180-day window
const RECENT = new Date(); // inside the window

/** Users, one per predicate arm. */
const ELIGIBLE_UNREACHABLE = 'c0407000-0000-4000-8000-000000000001';
const ELIGIBLE_GONE = 'c0407000-0000-4000-8000-000000000002';
const ACTIVE_RECENTLY = 'c0407000-0000-4000-8000-000000000003';
const REACHABLE = 'c0407000-0000-4000-8000-000000000004';
const SUPERUSER = 'c0407000-0000-4000-8000-000000000005';
const EXEMPT = 'c0407000-0000-4000-8000-000000000006';
const NEVER_STAMPED_YOUNG = 'c0407000-0000-4000-8000-000000000007';

const PERSONALITY_SHARED = 'c0407000-0000-4000-8000-0000000000a1';
const PERSONALITY_SOLO = 'c0407000-0000-4000-8000-0000000000a2';
const OTHER_USER = 'c0407000-0000-4000-8000-0000000000b1';
const OTHER_PERSONA = 'c0407000-0000-4000-8000-0000000000b2';

let seq = 0;
const nextId = (): string =>
  `c0407000-0000-4000-8000-0000000001${(seq++).toString().padStart(2, '0')}`;

describe('RetentionPurgeService (component, PGLite)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;
  let service: RetentionPurgeService;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;
    service = new RetentionPurgeService({ prisma });

    const seed = async (userId: string, name: string): Promise<void> => {
      await seedUserWithPersona(prisma, {
        userId,
        personaId: nextId(),
        discordId: `9000000000000000${(seq + 10).toString().padStart(2, '0')}`,
        username: name,
        personaName: `${name} Persona`,
        personaContent: 'x',
      });
    };

    for (const [id, name] of [
      [ELIGIBLE_UNREACHABLE, 'unreachable'],
      [ELIGIBLE_GONE, 'goneaccount'],
      [ACTIVE_RECENTLY, 'activerecent'],
      [REACHABLE, 'reachable'],
      [SUPERUSER, 'superowner'],
      [EXEMPT, 'exemptuser'],
      [NEVER_STAMPED_YOUNG, 'youngnostamp'],
    ] as const) {
      await seed(id, name);
    }
    await seedUserWithPersona(prisma, {
      userId: OTHER_USER,
      personaId: OTHER_PERSONA,
      discordId: '900000000000000099',
      username: 'otheractive',
      personaName: 'Other Persona',
      personaContent: 'x',
    });

    // Raw SQL for the retention columns: they're deliberately off the Prisma
    // client path in production (sync-LWW), and created_at needs forcing too.
    await prisma.$executeRaw`
      UPDATE users SET dm_undeliverable_since = ${OLD}, last_active_at = ${OLD}
      WHERE id = ${ELIGIBLE_UNREACHABLE}::uuid
    `;
    await prisma.$executeRaw`
      UPDATE users SET discord_account_gone_at = ${OLD}, last_active_at = ${OLD}
      WHERE id = ${ELIGIBLE_GONE}::uuid
    `;
    // Unreachable but ACTIVE recently → excluded (the flag alone isn't enough).
    await prisma.$executeRaw`
      UPDATE users SET dm_undeliverable_since = ${OLD}, last_active_at = ${RECENT}
      WHERE id = ${ACTIVE_RECENTLY}::uuid
    `;
    // Inactive but REACHABLE → excluded (Phase 2 is the unreachable branch only).
    await prisma.$executeRaw`
      UPDATE users SET last_active_at = ${OLD} WHERE id = ${REACHABLE}::uuid
    `;
    // Unreachable + inactive, but exempted two different ways → excluded.
    await prisma.$executeRaw`
      UPDATE users SET dm_undeliverable_since = ${OLD}, last_active_at = ${OLD}, is_superuser = true
      WHERE id = ${SUPERUSER}::uuid
    `;
    await prisma.$executeRaw`
      UPDATE users SET dm_undeliverable_since = ${OLD}, last_active_at = ${OLD}, retention_exempt = true
      WHERE id = ${EXEMPT}::uuid
    `;
    // Never stamped (NULL last_active_at) but created recently → the COALESCE
    // fallback must read created_at and EXCLUDE them.
    await prisma.$executeRaw`
      UPDATE users SET dm_undeliverable_since = ${OLD}, last_active_at = NULL, created_at = ${RECENT}
      WHERE id = ${NEVER_STAMPED_YOUNG}::uuid
    `;

    // Characters owned by the unreachable user: SHARED has another user's
    // memory (→ re-home), SOLO has none (→ delete).
    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, slug, character_info, personality_traits, owner_id, updated_at)
      VALUES (${PERSONALITY_SHARED}::uuid, 'Shared', 'shared-cohort', 'c', 'Warm', ${ELIGIBLE_UNREACHABLE}::uuid, NOW()),
             (${PERSONALITY_SOLO}::uuid, 'Solo', 'solo-cohort', 'c', 'Quiet', ${ELIGIBLE_UNREACHABLE}::uuid, NOW())
    `;
    await prisma.memory.create({
      data: {
        id: nextId(),
        personaId: OTHER_PERSONA,
        personalityId: PERSONALITY_SHARED,
        content: 'other-user-with-shared',
        senders: ['otheractive'],
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  it('selects exactly the unreachable-and-inactive cohort', async () => {
    const cohort = await service.selectPurgeCohort();

    expect(cohort.map(row => row.userId).sort()).toEqual(
      [ELIGIBLE_UNREACHABLE, ELIGIBLE_GONE].sort()
    );
    // Every exclusion is load-bearing — name them so a regression is legible.
    const ids = cohort.map(row => row.userId);
    expect(ids).not.toContain(ACTIVE_RECENTLY); // active again
    expect(ids).not.toContain(REACHABLE); // still reachable
    expect(ids).not.toContain(SUPERUSER); // bot owner
    expect(ids).not.toContain(EXEMPT); // retention_exempt (also the orphan sentinel)
    expect(ids).not.toContain(NEVER_STAMPED_YOUNG); // NULL last_active_at → created_at fallback
  });

  it('labels each eligible user with the signal that made them eligible', async () => {
    const cohort = await service.selectPurgeCohort();
    const byId = new Map(cohort.map(row => [row.userId, row.reason]));

    expect(byId.get(ELIGIBLE_UNREACHABLE)).toBe('unreachable');
    expect(byId.get(ELIGIBLE_GONE)).toBe('account_gone');
  });

  it('reports the character split and userbase share in the preview', async () => {
    const preview = await service.buildPreview();

    const unreachable = preview.users.find(user => user.reason === 'unreachable');
    // SHARED has another user's memory → re-home; SOLO has none → delete.
    expect(unreachable?.ownedCharacters).toEqual({ toDelete: 1, toReHome: 1 });
    expect(preview.totals.charactersToDelete).toBe(1);
    expect(preview.totals.charactersToReHome).toBe(1);

    expect(preview.totals.eligibleCount).toBe(2);
    expect(preview.totals.userbaseCount).toBe(8);
    // 2/8 = 25% — over the 15% warn line, so the breaker annotation fires.
    expect(preview.totals.percentOfUserbase).toBe(25);
    expect(preview.totals.breakerWarning).toBe(true);
  });
});

/**
 * The destructive path, end to end over real PGLite: a genuine cascade, the
 * real re-home, the real audit write, and the real tombstone triggers.
 *
 * Its own PGLite instance — the predicate suite above asserts on a fixed
 * userbase, and purging inside it would delete the fixtures the later
 * assertions read.
 */
describe('RetentionPurgeService.purgeUser (component, PGLite)', () => {
  const DEPARTED = 'c0407100-0000-4000-8000-000000000001';
  const DEPARTED_PERSONA = 'c0407100-0000-4000-8000-000000000002';
  const SURVIVOR = 'c0407100-0000-4000-8000-000000000003';
  const SURVIVOR_PERSONA = 'c0407100-0000-4000-8000-000000000004';
  const SHARED_CHAR = 'c0407100-0000-4000-8000-0000000000a1';
  const SOLO_CHAR = 'c0407100-0000-4000-8000-0000000000a2';
  const GRANTED_CHAR = 'c0407100-0000-4000-8000-0000000000a3';
  const DEPARTED_DISCORD = '900000000000000201';
  const SURVIVOR_DISCORD = '900000000000000202';
  const SENTINEL_ID = generateUserUuid(ORPHAN_SENTINEL_DISCORD_ID);
  const OLD_ISO = '2020-01-01T00:00:00Z';

  let pseq = 0;
  const pid = (): string =>
    `c0407100-0000-4000-8000-0000000003${(pseq++).toString().padStart(2, '0')}`;

  let pglite: PGlite;
  let prisma: PrismaClient;
  let service: RetentionPurgeService;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;
    service = new RetentionPurgeService({ prisma });

    await seedUserWithPersona(prisma, {
      userId: DEPARTED,
      personaId: DEPARTED_PERSONA,
      discordId: DEPARTED_DISCORD,
      username: 'departeduser',
      personaName: 'Departed Persona',
      personaContent: 'x',
    });
    await seedUserWithPersona(prisma, {
      userId: SURVIVOR,
      personaId: SURVIVOR_PERSONA,
      discordId: SURVIVOR_DISCORD,
      username: 'survivoruser',
      personaName: 'Survivor Persona',
      personaContent: 'x',
    });

    // Filler users so the cohort is a plausible SHARE of the userbase. Without
    // them 1 eligible of 2 users is 50%, which correctly trips the hard-ceiling
    // breaker and blocks every purge in this suite — the breaker doing its job,
    // but not what these tests are here to prove (the unit suite pins that).
    for (let i = 0; i < 8; i++) {
      await seedUserWithPersona(prisma, {
        userId: pid(),
        personaId: pid(),
        discordId: `90000000000000031${String(i)}`,
        username: `filler${String(i)}`,
        personaName: `Filler ${String(i)} Persona`,
        personaContent: 'x',
      });
    }

    await prisma.$executeRaw`
      UPDATE users SET dm_undeliverable_since = ${OLD_ISO}::timestamptz,
                       last_active_at = ${OLD_ISO}::timestamptz
      WHERE id = ${DEPARTED}::uuid
    `;

    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, slug, character_info, personality_traits, owner_id, updated_at)
      VALUES (${SHARED_CHAR}::uuid, 'Shared', 'shared-purge', 'c', 'Warm', ${DEPARTED}::uuid, NOW()),
             (${SOLO_CHAR}::uuid, 'Solo', 'solo-purge', 'c', 'Quiet', ${DEPARTED}::uuid, NOW()),
             (${GRANTED_CHAR}::uuid, 'Granted', 'granted-purge', 'c', 'Shy', ${DEPARTED}::uuid, NOW())
    `;
    // GRANTED_CHAR has an explicit co-ownership GRANT and zero activity — the
    // one case only the personality_owners reach arm can catch. Its whole point
    // is a co-owner who hasn't chatted yet: every activity-based arm sees
    // nothing, so without the grant arm this character would be DELETED,
    // silently revoking live access. Inert in production today (the sole writer
    // inserts userId === ownerId), which is why it needs a real-DB assertion.
    await prisma.$executeRaw`
      INSERT INTO personality_owners (personality_id, user_id, created_at, updated_at)
      VALUES (${GRANTED_CHAR}::uuid, ${SURVIVOR}::uuid, NOW(), NOW())
    `;
    // The survivor's data on the shared character is what makes it cross-user.
    await prisma.memory.create({
      data: {
        id: pid(),
        personaId: SURVIVOR_PERSONA,
        personalityId: SHARED_CHAR,
        content: 'survivor-with-shared',
        senders: ['survivoruser'],
      },
    });
    // Conversation history on the SOLO character: it cascades with the account,
    // and the tombstone trigger must capture it (D8's purge-side proof).
    await prisma.conversationHistory.create({
      data: {
        id: pid(),
        personaId: DEPARTED_PERSONA,
        personalityId: SOLO_CHAR,
        role: 'user',
        content: 'departed-solo-chat',
        channelId: '700000000000000001',
      },
    });
    // A clean slate so the assertions read this purge's tombstones, not the
    // seeding's.
    await prisma.$executeRawUnsafe('DELETE FROM "sync_tombstones"');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  it('erases the account, re-homes the shared character, and logs the purge', async () => {
    const outcome = await service.purgeUser({
      discordId: DEPARTED_DISCORD,
      runContext: 'component-test',
    });

    expect(outcome).toMatchObject({
      status: 'purged',
      charactersDeleted: 1,
      charactersReHomed: 2,
    });

    expect(await prisma.user.findUnique({ where: { id: DEPARTED } })).toBeNull();
    expect(await prisma.personality.findUnique({ where: { id: SOLO_CHAR } })).toBeNull();

    const shared = await prisma.personality.findUnique({ where: { id: SHARED_CHAR } });
    expect(shared?.ownerId).toBe(SENTINEL_ID);
    expect(shared?.originalOwnerDiscordId).toBe(DEPARTED_DISCORD);

    // The grant-only character survives too — proving the personality_owners
    // arm works against a real database, not just in the SQL-text assertion.
    const granted = await prisma.personality.findUnique({ where: { id: GRANTED_CHAR } });
    expect(granted?.ownerId).toBe(SENTINEL_ID);
    expect(granted?.originalOwnerDiscordId).toBe(DEPARTED_DISCORD);

    // The survivor is untouched — the whole reason re-homing exists.
    expect(await prisma.user.findUnique({ where: { id: SURVIVOR } })).not.toBeNull();
    expect(await prisma.memory.count({ where: { content: 'survivor-with-shared' } })).toBe(1);

    // The ledger row settled: committed, and the off-DB cleanup ran to
    // completion (so its pending payload is cleared rather than kept forever).
    const audit = await prisma.retentionPurgeLog.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      targetDiscordId: DEPARTED_DISCORD,
      runContext: 'component-test',
      dbOutcome: 'success',
      offDbReconciled: 'done',
      offDbPending: null,
    });
  });

  it('tombstones the cascaded conversation_history so a sync cannot resurrect it', async () => {
    // D8: conversation_history became a normal sync table in Phase 1.5, so the
    // purge needs no CH-specific handling — but "needs none" is a claim about
    // the cascade actually firing the trigger, which only a real DB can prove.
    const tombstoned = await prisma.syncTombstone.findMany({
      where: { tableName: 'conversation_history' },
    });

    expect(tombstoned.length).toBeGreaterThan(0);
  });

  it('is idempotent — re-running reports already_gone instead of erroring', async () => {
    const outcome = await service.purgeUser({
      discordId: DEPARTED_DISCORD,
      runContext: 'component-test',
    });

    expect(outcome).toEqual({
      status: 'skipped',
      discordId: DEPARTED_DISCORD,
      reason: 'already_gone',
    });
    // No second ledger row: nothing was purged, so nothing is audited.
    expect(await prisma.retentionPurgeLog.count()).toBe(1);
  });

  it('leaves an ineligible user completely alone', async () => {
    const outcome = await service.purgeUser({
      discordId: SURVIVOR_DISCORD,
      runContext: 'component-test',
    });

    expect(outcome).toMatchObject({ status: 'skipped', reason: 'no_longer_eligible' });
    expect(await prisma.user.findUnique({ where: { id: SURVIVOR } })).not.toBeNull();
    expect(await prisma.persona.count({ where: { ownerId: SURVIVOR } })).toBe(1);
  });

  it('never selects the orphan sentinel it just created', async () => {
    // The sentinel now holds a re-homed character and is itself unreachable by
    // construction. If the predicate could pick it up, a later purge run would
    // delete exactly the characters this one preserved.
    const cohort = await service.selectPurgeCohort();

    expect(cohort.map(row => row.userId)).not.toContain(SENTINEL_ID);
  });
});
