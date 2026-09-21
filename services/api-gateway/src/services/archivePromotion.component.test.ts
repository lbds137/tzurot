/**
 * Component test: archive auto-promotion over a REAL Prisma client (PGLite).
 * Pins the acceptance behavior a mocked-prisma unit test cannot observe: the
 * optimistic-concurrency settings write against Prisma's actual row, and
 * that a failed personality write rolls the settings-list appends back
 * (both writes share one transaction).
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { Prisma, PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import { ARCHIVE_SUMMARY_PROMPT_VERSION } from '@tzurot/common-types/constants/memoryArchive';
import { runArchivePromotion } from './archivePromotion.js';

const USER_ID = 'a4c00000-0000-4000-8000-0000000000a1';
const PERSONA_ID = 'a4c00000-0000-4000-8000-0000000000a2';
const DISCORD_ID = '900000000000000091';

const PERSONALITY_FULL = 'a4c00000-0000-4000-8000-0000000000b1'; // 100/100 coverage
const PERSONALITY_PARTIAL = 'a4c00000-0000-4000-8000-0000000000b2'; // 47/50 coverage
const PERSONALITY_OPTED_OUT = 'a4c00000-0000-4000-8000-0000000000b3'; // 100/100 coverage, opted out

/**
 * Wrap a prisma client so any transaction's `personality.updateMany` always
 * rejects, while `findUnique` still reaches the real transaction client (so
 * the in-transaction re-read behaves normally) and every other model
 * delegate is untouched.
 */
function withFailingPersonalityWrite(prisma: PrismaClient): PrismaClient {
  return new Proxy(prisma, {
    get(target, prop) {
      if (prop === '$transaction') {
        return (fn: (tx: unknown) => Promise<unknown>) =>
          (target as PrismaClient).$transaction((tx: unknown) =>
            fn(
              new Proxy(tx as object, {
                get(txTarget, txProp) {
                  if (txProp === 'personality') {
                    const realPersonality = Reflect.get(txTarget, txProp) as {
                      findUnique: (args: unknown) => Promise<unknown>;
                    };
                    return {
                      findUnique: (args: unknown) => realPersonality.findUnique(args),
                      updateMany: () =>
                        Promise.reject(new Error('simulated personality.updateMany failure')),
                    };
                  }
                  return Reflect.get(txTarget, txProp);
                },
              })
            )
          );
      }
      return Reflect.get(target, prop);
    },
  }) as unknown as PrismaClient;
}

/**
 * Wrap a prisma client so any transaction's `personality.findUnique` returns
 * the REAL row with `updatedAt` shifted one second into the past — a stale
 * read — while `updateMany` stays entirely real. The guarded update then
 * matches zero rows, so `writePersonalityRenderMode` throws
 * `ConcurrentPersonalityWrite` inside the transaction and Prisma rolls the
 * settings-list append back with it.
 */
function withStalePersonalityRead(prisma: PrismaClient): PrismaClient {
  return new Proxy(prisma, {
    get(target, prop) {
      if (prop === '$transaction') {
        return (fn: (tx: unknown) => Promise<unknown>) =>
          (target as PrismaClient).$transaction((tx: unknown) =>
            fn(
              new Proxy(tx as object, {
                get(txTarget, txProp) {
                  if (txProp === 'personality') {
                    const realPersonality = Reflect.get(txTarget, txProp) as {
                      findUnique: (args: unknown) => Promise<unknown>;
                      updateMany: (args: unknown) => Promise<unknown>;
                    };
                    return {
                      findUnique: async (args: unknown) => {
                        const row = await realPersonality.findUnique(args);
                        if (row === null) {
                          return null;
                        }
                        return {
                          ...row,
                          updatedAt: new Date(
                            (row as { updatedAt: Date }).updatedAt.getTime() - 1000
                          ),
                        };
                      },
                      updateMany: (args: unknown) => realPersonality.updateMany(args),
                    };
                  }
                  return Reflect.get(txTarget, txProp);
                },
              })
            )
          );
      }
      return Reflect.get(target, prop);
    },
  }) as unknown as PrismaClient;
}

/**
 * Resets the mutable state each test asserts against — the settings bag back
 * to just the kill switch plus the standing opt-out entry, and all three
 * seeded personalities' `configDefaults` back to null — so every `it()`
 * starts from the same baseline `beforeAll` left, regardless of what an
 * earlier test did. The memory rows themselves are read-only to
 * `runArchivePromotion` and stay shared across tests.
 *
 * The opt-out entry for `opted-out-coverage` is what keeps that third,
 * always-100%-coverage fixture INERT in every case that isn't about opt-out
 * — without it, that personality would be a candidate (and get promoted) in
 * every other test, breaking their exact-list assertions.
 */
async function resetPromotionState(prisma: PrismaClient): Promise<void> {
  await prisma.adminSettings.update({
    where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    data: {
      systemSettings: {
        archivePromotionEnabled: true,
        archivePromotionOptOutPersonalities: ['opted-out-coverage'],
      },
    },
  });
  await prisma.personality.updateMany({
    where: { id: { in: [PERSONALITY_FULL, PERSONALITY_PARTIAL, PERSONALITY_OPTED_OUT] } },
    data: { configDefaults: Prisma.JsonNull },
  });
}

async function seedMemories(
  prisma: PrismaClient,
  personalityId: string,
  total: number,
  doneCount: number
): Promise<void> {
  const now = new Date();
  const data = Array.from({ length: total }, (_, i) => ({
    id: randomUUID(),
    personalityId,
    content: `memory ${i}`,
    lastRetrievedAt: now,
    chunkGroupId: null,
    summaryStatus: i < doneCount ? 'done' : null,
    summaryPromptVersion: i < doneCount ? ARCHIVE_SUMMARY_PROMPT_VERSION : null,
  }));
  await prisma.memory.createMany({ data });
}

describe('runArchivePromotion (component, PGLite)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;

    await seedUserWithPersona(prisma, {
      userId: USER_ID,
      personaId: PERSONA_ID,
      discordId: DISCORD_ID,
    });

    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, slug, character_info, personality_traits, owner_id, updated_at)
      VALUES (${PERSONALITY_FULL}::uuid, 'FullBot', 'full-coverage', 'Full character', 'Thorough', ${USER_ID}::uuid, NOW()),
             (${PERSONALITY_PARTIAL}::uuid, 'PartialBot', 'partial-coverage', 'Partial character', 'Incomplete', ${USER_ID}::uuid, NOW()),
             (${PERSONALITY_OPTED_OUT}::uuid, 'OptOutBot', 'opted-out-coverage', 'Opted-out character', 'Excluded', ${USER_ID}::uuid, NOW())
    `;

    await seedMemories(prisma, PERSONALITY_FULL, 100, 100);
    await seedMemories(prisma, PERSONALITY_PARTIAL, 50, 47);
    await seedMemories(prisma, PERSONALITY_OPTED_OUT, 50, 50);

    await prisma.adminSettings.create({
      data: {
        id: ADMIN_SETTINGS_SINGLETON_ID,
        systemSettings: { archivePromotionEnabled: true },
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  it('MEM-ARCH-033: promotes the 100% personality into both lists and sets its render-mode tier; the 94% one is left out', async () => {
    await resetPromotionState(prisma);

    const result = await runArchivePromotion({ prisma });

    expect(result.enabled).toBe(true);
    const promotedSlugs = result.promoted.map(p => p.slug);
    expect(promotedSlugs).toContain('full-coverage');
    expect(promotedSlugs).not.toContain('partial-coverage');

    const settingsRow = await prisma.adminSettings.findUniqueOrThrow({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    });
    const bag = settingsRow.systemSettings as Record<string, unknown>;
    expect(bag.archiveSplitRenderPersonalities).toEqual(['full-coverage']);
    expect(bag.recentDaysDigestPersonalities).toEqual(['full-coverage']);

    const fullPersonality = await prisma.personality.findUniqueOrThrow({
      where: { id: PERSONALITY_FULL },
    });
    expect(
      (fullPersonality.configDefaults as Record<string, unknown> | null)?.crossChannelRenderMode
    ).toBe('user-only');

    const partialPersonality = await prisma.personality.findUniqueOrThrow({
      where: { id: PERSONALITY_PARTIAL },
    });
    expect(partialPersonality.configDefaults).toBeNull();
  });

  it('MEM-ARCH-033: converges a split-listed personality that is missing the digest listing and the render mode', async () => {
    await resetPromotionState(prisma);
    await prisma.adminSettings.update({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
      data: {
        systemSettings: {
          archivePromotionEnabled: true,
          archivePromotionOptOutPersonalities: ['opted-out-coverage'],
          archiveSplitRenderPersonalities: ['full-coverage'],
        },
      },
    });

    const result = await runArchivePromotion({ prisma });

    const fullPromotion = result.promoted.find(p => p.slug === 'full-coverage');
    expect(fullPromotion).toBeDefined();
    expect(fullPromotion?.writes).toEqual({
      archiveSplitRender: false,
      recentDaysDigest: true,
      renderMode: true,
    });
    expect(result.skipped.alreadyListed).toBe(0);

    const settingsRow = await prisma.adminSettings.findUniqueOrThrow({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    });
    const bag = settingsRow.systemSettings as Record<string, unknown>;
    expect(bag.archiveSplitRenderPersonalities).toEqual(['full-coverage']);
    expect(bag.recentDaysDigestPersonalities).toEqual(['full-coverage']);

    const fullPersonality = await prisma.personality.findUniqueOrThrow({
      where: { id: PERSONALITY_FULL },
    });
    expect(
      (fullPersonality.configDefaults as Record<string, unknown> | null)?.crossChannelRenderMode
    ).toBe('user-only');

    expect(result.evaluated).toBe(
      result.promoted.length +
        result.skipped.notReady +
        result.skipped.optedOut +
        result.skipped.alreadyListed +
        result.skipped.conflicted
    );
  });

  it('MEM-ARCH-033: respects an explicit creator render mode — promotes the lists and leaves configDefaults untouched', async () => {
    await resetPromotionState(prisma);
    await prisma.personality.update({
      where: { id: PERSONALITY_FULL },
      data: { configDefaults: { crossChannelRenderMode: 'both' } },
    });

    const result = await runArchivePromotion({ prisma });

    const fullPromotion = result.promoted.find(p => p.slug === 'full-coverage');
    expect(fullPromotion).toBeDefined();
    expect(fullPromotion?.writes).toEqual({
      archiveSplitRender: true,
      recentDaysDigest: true,
      renderMode: false,
    });

    const settingsRow = await prisma.adminSettings.findUniqueOrThrow({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    });
    const bag = settingsRow.systemSettings as Record<string, unknown>;
    expect(bag.archiveSplitRenderPersonalities).toEqual(['full-coverage']);
    expect(bag.recentDaysDigestPersonalities).toEqual(['full-coverage']);

    const fullPersonality = await prisma.personality.findUniqueOrThrow({
      where: { id: PERSONALITY_FULL },
    });
    expect(
      (fullPersonality.configDefaults as Record<string, unknown> | null)?.crossChannelRenderMode
    ).toBe('both');
  });

  it('idempotence: a second run promotes nothing further and each list keeps exactly one copy of the slug', async () => {
    await resetPromotionState(prisma);

    const first = await runArchivePromotion({ prisma });
    expect(first.promoted.map(p => p.slug)).toContain('full-coverage');

    const second = await runArchivePromotion({ prisma });
    expect(second.promoted).toHaveLength(0);
    expect(second.skipped.alreadyListed).toBeGreaterThanOrEqual(1);

    const settingsRow = await prisma.adminSettings.findUniqueOrThrow({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    });
    const bag = settingsRow.systemSettings as Record<string, unknown>;
    expect(bag.archiveSplitRenderPersonalities).toEqual(['full-coverage']);
    expect(bag.recentDaysDigestPersonalities).toEqual(['full-coverage']);
  });

  it('MEM-ARCH-035: atomicity: a failed personality write leaves the settings lists unchanged', async () => {
    await resetPromotionState(prisma);

    const before = await prisma.adminSettings.findUniqueOrThrow({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    });
    const beforeBag = before.systemSettings as Record<string, unknown>;
    expect(beforeBag.archiveSplitRenderPersonalities).toBeUndefined();

    // The injected failure is a plain Error (not the ConcurrentSettingsWrite /
    // InvalidConfigDefaultsMerge / ConcurrentPersonalityWrite sentinels
    // promoteOne catches), so it propagates out of runArchivePromotion — the
    // atomicity guarantee under test is Prisma's own transaction rollback,
    // not a caught-and-continued candidate.
    const failingPrisma = withFailingPersonalityWrite(prisma);
    await expect(runArchivePromotion({ prisma: failingPrisma })).rejects.toThrow(
      'simulated personality.updateMany failure'
    );

    const after = await prisma.adminSettings.findUniqueOrThrow({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    });
    const afterBag = after.systemSettings as Record<string, unknown>;
    expect(afterBag).toEqual(beforeBag);
    expect(afterBag.archiveSplitRenderPersonalities).toBeUndefined();
    expect(afterBag.recentDaysDigestPersonalities).toBeUndefined();
  });

  it('MEM-ARCH-034: opt-out: a personality at the gate whose slug is on the opt-out list is never promoted', async () => {
    await resetPromotionState(prisma);
    // Its own bag, not just the reset baseline, so every count below is
    // exact: full-coverage already listed, opted-out-coverage opted out,
    // partial-coverage below the gate — one personality per disposition.
    await prisma.adminSettings.update({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
      data: {
        systemSettings: {
          archivePromotionEnabled: true,
          archivePromotionOptOutPersonalities: ['opted-out-coverage'],
          archiveSplitRenderPersonalities: ['full-coverage'],
          recentDaysDigestPersonalities: ['full-coverage'],
        },
      },
    });
    await prisma.personality.update({
      where: { id: PERSONALITY_FULL },
      data: { configDefaults: { crossChannelRenderMode: 'user-only' } },
    });

    const result = await runArchivePromotion({ prisma });

    expect(result.promoted).toHaveLength(0);
    expect(result.skipped.optedOut).toBe(1);
    expect(result.skipped.alreadyListed).toBe(1);
    expect(result.skipped.notReady).toBe(1);

    const settingsRow = await prisma.adminSettings.findUniqueOrThrow({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    });
    const bag = settingsRow.systemSettings as Record<string, unknown>;
    expect(bag.archiveSplitRenderPersonalities).toEqual(['full-coverage']);
    expect(bag.recentDaysDigestPersonalities).toEqual(['full-coverage']);

    const optedOutPersonality = await prisma.personality.findUniqueOrThrow({
      where: { id: PERSONALITY_OPTED_OUT },
    });
    expect(optedOutPersonality.configDefaults).toBeNull();
  });

  it('MEM-ARCH-036: a stale personality read rolls the settings-list append back over a real transaction', async () => {
    await resetPromotionState(prisma);

    const result = await runArchivePromotion({ prisma: withStalePersonalityRead(prisma) });

    expect(result.promoted).toHaveLength(0);
    expect(result.skipped.conflicted).toBe(1);

    const settingsRow = await prisma.adminSettings.findUniqueOrThrow({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    });
    const bag = settingsRow.systemSettings as Record<string, unknown>;
    expect(bag.archiveSplitRenderPersonalities).toBeUndefined();
    expect(bag.recentDaysDigestPersonalities).toBeUndefined();

    const fullPersonality = await prisma.personality.findUniqueOrThrow({
      where: { id: PERSONALITY_FULL },
    });
    expect(fullPersonality.configDefaults).toBeNull();
  });

  it('MEM-ARCH-037: a malformed render list refuses every write and is never rewritten', async () => {
    await resetPromotionState(prisma);
    await prisma.adminSettings.update({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
      data: {
        systemSettings: {
          archivePromotionEnabled: true,
          archivePromotionOptOutPersonalities: ['opted-out-coverage'],
          archiveSplitRenderPersonalities: ['legacy-persona', 7],
        },
      },
    });

    const result = await runArchivePromotion({ prisma });

    expect(result.promoted).toHaveLength(0);
    expect(result.skipped.conflicted).toBe(1);

    const settingsRow = await prisma.adminSettings.findUniqueOrThrow({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    });
    const bag = settingsRow.systemSettings as Record<string, unknown>;
    expect(bag.archiveSplitRenderPersonalities).toEqual(['legacy-persona', 7]);
    expect(bag.recentDaysDigestPersonalities).toBeUndefined();

    const fullPersonality = await prisma.personality.findUniqueOrThrow({
      where: { id: PERSONALITY_FULL },
    });
    expect(fullPersonality.configDefaults).toBeNull();
  });
});
