/**
 * Component Test: roster blurb sweep (real SQL)
 *
 * The whole staleness design rests on SQL semantics that unit mocks cannot
 * model: `IS DISTINCT FROM` against a null, the interaction between the
 * stamping pass and the stale query when both run in one tick, and the
 * ordering that decides whose blurb a limited budget pays for. A mocked
 * `$queryRaw` returns whatever the test seeded it with, so it can only ever
 * confirm the test's own assumption — which is exactly how a false claim about
 * same-tick behaviour survived a green unit suite here.
 *
 * These run against PGlite, so the assertions are about Postgres, not about a
 * mock.
 */

import type { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import { hashRosterBlurbCard } from '@tzurot/common-types/utils/rosterBlurbCard';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { sweepRosterBlurbs } from './rosterBlurbSweep.js';
import type { SystemModelInvoker } from '../services/systemModel/systemModelCall.js';
import { AIProvider } from '@tzurot/common-types/constants/ai';

const OWNER_ID = '4f9b0f66-0000-4000-8000-0000000000b0';
const PERSONA_ID = '4f9b0f66-0000-4000-8000-0000000000b1';

let pglite: PGlite;
let prisma: PrismaClient;

function id(n: number): string {
  return `4f9b0f66-0000-4000-8000-0000000000${n.toString(16).padStart(2, '0')}`;
}

/** The exact card `seedCharacter` writes, so a test can hash it itself. */
function cardFor(
  n: number,
  characterInfo: string
): {
  name: string;
  displayName: null;
  characterInfo: string;
  personalityTraits: string;
  personalityTone: null;
  personalityAge: null;
  personalityAppearance: null;
  personalityLikes: null;
  personalityDislikes: null;
  conversationalGoals: null;
} {
  return {
    name: `char-${n}`,
    displayName: null,
    characterInfo,
    personalityTraits: 'traits',
    personalityTone: null,
    personalityAge: null,
    personalityAppearance: null,
    personalityLikes: null,
    personalityDislikes: null,
    conversationalGoals: null,
  };
}

/** Insert one character. `blurbHash` null = never generated. */
async function seedCharacter(options: {
  n: number;
  characterInfo: string;
  blurbHash?: string | null;
  stamp?: boolean;
}): Promise<void> {
  const { n, characterInfo, blurbHash = null, stamp = true } = options;
  const card = cardFor(n, characterInfo);
  await prisma.$executeRaw`
    INSERT INTO personalities
      (id, name, slug, character_info, personality_traits, owner_id, updated_at,
       card_source_hash, roster_blurb_source_hash)
    VALUES (${id(n)}::uuid, ${card.name}, ${`char-${n}`}, ${characterInfo}, 'traits',
            ${OWNER_ID}::uuid, NOW(),
            ${stamp ? hashRosterBlurbCard(card) : null}, ${blurbHash})
  `;
}

function invoker(): SystemModelInvoker {
  return vi.fn<SystemModelInvoker>().mockResolvedValue({
    content: '{"blurb":"A generated description."}',
    tokensIn: 10,
    tokensOut: 5,
    provider: AIProvider.OpenRouter,
    model: 'z-ai/glm-5.2',
  });
}

/** A model call that is PAID FOR and returns something unparseable. */
function unparseableInvoker(): SystemModelInvoker {
  return vi.fn<SystemModelInvoker>().mockResolvedValue({
    content: 'not json at all',
    tokensIn: 10,
    tokensOut: 5,
    provider: AIProvider.OpenRouter,
    model: 'z-ai/glm-5.2',
  });
}

interface FailureState {
  roster_blurb_attempts: number;
  roster_blurb_last_failed_at: Date | null;
  roster_blurb_failed_source_hash: string | null;
}

/** Stamp failure state onto a seeded row, as a run of failed sweeps would. */
async function seedFailureState(options: {
  n: number;
  attempts: number;
  failedHash: string;
  minutesAgo: number;
}): Promise<void> {
  const { n, attempts, failedHash, minutesAgo } = options;
  await prisma.$executeRaw`
    UPDATE personalities
    SET roster_blurb_attempts = ${attempts},
        roster_blurb_failed_source_hash = ${failedHash},
        roster_blurb_last_failed_at = NOW() - (interval '1 minute' * ${minutesAgo}::int)
    WHERE id = ${id(n)}::uuid
  `;
}

async function failureState(n: number): Promise<FailureState> {
  const rows = await prisma.$queryRaw<FailureState[]>`
    SELECT roster_blurb_attempts, roster_blurb_last_failed_at, roster_blurb_failed_source_hash
    FROM personalities WHERE id = ${id(n)}::uuid
  `;
  return rows[0];
}

beforeAll(async () => {
  pglite = await createTestPGlite();
  await pglite.exec(loadPGliteSchema());
  prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) });
  await seedUserWithPersona(prisma, {
    userId: OWNER_ID,
    personaId: PERSONA_ID,
    discordId: '100000000000000001',
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  await pglite.close();
});

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM usage_logs`;
  await prisma.$executeRaw`DELETE FROM personalities`;
  registerSystemSettings({
    get: (key: string) =>
      key === 'rosterBlurbEnabled' ? true : key === 'extractionModel' ? 'z-ai/glm-5.2' : undefined,
  } as unknown as SystemSettingsService);
});

afterAll(() => resetSystemSettingsRegistration());

describe('the affected-row-count premise the stamp counter rests on', () => {
  it('resolves $executeRaw to 0 when the guarded UPDATE matches nothing', async () => {
    // stampMissingHashes counts a row only when `affected > 0`, which assumes
    // Prisma resolves $executeRaw to the affected-row count rather than, say,
    // a void or a truthy handle. Probed against real Postgres instead of
    // trusted, because the whole point of the counter fix is that a guarded
    // no-op is indistinguishable from success unless this holds.
    await seedCharacter({ n: 40, characterInfo: 'Already stamped.' });

    const affected = await prisma.$executeRaw`
      UPDATE personalities
      SET card_source_hash = 'x'
      WHERE id = ${id(40)}::uuid AND card_source_hash IS NULL
    `;

    expect(affected).toBe(0);
  });

  it('resolves to 1 when the same UPDATE does match', async () => {
    await seedCharacter({ n: 41, characterInfo: 'Not stamped.', stamp: false });

    const affected = await prisma.$executeRaw`
      UPDATE personalities
      SET card_source_hash = 'x'
      WHERE id = ${id(41)}::uuid AND card_source_hash IS NULL
    `;

    expect(affected).toBe(1);
  });
});

describe('staleness detection against real SQL', () => {
  it('selects a never-generated row, which `!=` would have skipped', async () => {
    // NULL != 'hash' is NULL, not TRUE — the reason the query uses
    // IS DISTINCT FROM. This is the row that most needs generating.
    await seedCharacter({ n: 1, characterInfo: 'An archivist.', blurbHash: null });

    const stats = await sweepRosterBlurbs(prisma, invoker());

    expect(stats.generated).toBe(1);
  });

  it('skips a row whose stored blurb hash already matches its card', async () => {
    const card = cardFor(2, 'An archivist.');
    await seedCharacter({
      n: 2,
      characterInfo: 'An archivist.',
      blurbHash: hashRosterBlurbCard(card),
    });

    const stats = await sweepRosterBlurbs(prisma, invoker());

    expect(stats.staleFound).toBe(0);
    expect(stats.generated).toBe(0);
  });

  it('generates a freshly stamped row in the SAME tick', async () => {
    // The behaviour a comment here once denied. A just-stamped row has a null
    // blurb hash, and NULL IS DISTINCT FROM 'hash' is TRUE, so it is eligible
    // immediately. Pinned so the doc comment and Postgres cannot drift again.
    await seedCharacter({ n: 3, characterInfo: 'An archivist.', stamp: false });

    const stats = await sweepRosterBlurbs(prisma, invoker());

    expect(stats.stamped).toBe(1);
    expect(stats.generated).toBe(1);
  });

  it('pays for edits before legacy backfill when the budget is short', async () => {
    // 12 never-generated rows and one edited row, against a 10-call budget.
    // Without the ORDER BY the edit can lose to the backfill for many ticks.
    for (let n = 10; n < 22; n++) {
      await seedCharacter({ n, characterInfo: 'Legacy character.', blurbHash: null });
    }
    await seedCharacter({ n: 5, characterInfo: 'Edited just now.', blurbHash: 'stale-hash-value' });

    const stats = await sweepRosterBlurbs(prisma, invoker());

    expect(stats.generated).toBe(10);
    const edited = await prisma.$queryRaw<{ roster_blurb: string | null }[]>`
      SELECT roster_blurb FROM personalities WHERE id = ${id(5)}::uuid
    `;
    expect(edited[0].roster_blurb).toBe('A generated description.');
  });

  it('marks an empty card current without calling the model', async () => {
    await prisma.$executeRaw`
      INSERT INTO personalities
        (id, name, slug, character_info, personality_traits, owner_id, updated_at, card_source_hash)
      VALUES (${id(6)}::uuid, '', 'blank', '', '', ${OWNER_ID}::uuid, NOW(),
              ${hashRosterBlurbCard({
                name: '',
                displayName: null,
                characterInfo: '',
                personalityTraits: '',
                personalityTone: null,
                personalityAge: null,
                personalityAppearance: null,
                personalityLikes: null,
                personalityDislikes: null,
                conversationalGoals: null,
              })})
    `;
    const invoke = invoker();

    const stats = await sweepRosterBlurbs(prisma, invoke);

    expect(stats.stampedEmpty).toBe(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not bump updated_at when it stores a blurb', async () => {
    // The row is sync-tracked and reconciled last-write-wins on updated_at, so
    // a generated blurb must never out-rank a real card edit in the other
    // environment. This is what the raw-SQL write buys, asserted rather than
    // argued.
    await seedCharacter({ n: 7, characterInfo: 'An archivist.', blurbHash: null });
    const before = await prisma.$queryRaw<{ updated_at: Date }[]>`
      SELECT updated_at FROM personalities WHERE id = ${id(7)}::uuid
    `;

    await sweepRosterBlurbs(prisma, invoker());

    const after = await prisma.$queryRaw<{ updated_at: Date }[]>`
      SELECT updated_at FROM personalities WHERE id = ${id(7)}::uuid
    `;
    expect(after[0].updated_at.getTime()).toBe(before[0].updated_at.getTime());
  });
});

describe('failure backoff against real SQL', () => {
  it('holds a row inside its backoff window, then admits it once the window passes', async () => {
    const info = 'An archivist.';
    await seedCharacter({ n: 50, characterInfo: info });
    const hash = hashRosterBlurbCard(cardFor(50, info));
    await seedFailureState({ n: 50, attempts: 1, failedHash: hash, minutesAgo: 30 });

    const held = await sweepRosterBlurbs(prisma, invoker());
    expect(held.staleFound).toBe(0);

    // After one failure the wait is one hour. The row is otherwise unchanged —
    // only the clock moved.
    await seedFailureState({ n: 50, attempts: 1, failedHash: hash, minutesAgo: 90 });
    const admitted = await sweepRosterBlurbs(prisma, invoker());
    expect(admitted.generated).toBe(1);
  });

  it('doubles the wait with each attempt rather than retrying on a flat interval', async () => {
    const info = 'A second archivist.';
    await seedCharacter({ n: 51, characterInfo: info });
    const hash = hashRosterBlurbCard(cardFor(51, info));

    // Two failures means a two-hour wait: 90 minutes is not enough, where at
    // attempts=1 it would have been.
    await seedFailureState({ n: 51, attempts: 2, failedHash: hash, minutesAgo: 90 });
    expect((await sweepRosterBlurbs(prisma, invoker())).staleFound).toBe(0);

    await seedFailureState({ n: 51, attempts: 2, failedHash: hash, minutesAgo: 180 });
    expect((await sweepRosterBlurbs(prisma, invoker())).generated).toBe(1);
  });

  it('freezes a row at the attempt cap no matter how long it waits', async () => {
    const info = 'A hopeless card.';
    await seedCharacter({ n: 52, characterInfo: info });
    await seedFailureState({
      n: 52,
      attempts: 5,
      failedHash: hashRosterBlurbCard(cardFor(52, info)),
      minutesAgo: 60 * 24 * 100,
    });

    const invoke = invoker();
    const stats = await sweepRosterBlurbs(prisma, invoke);

    // A hundred days later it is still frozen — the cap is not a long backoff.
    expect(stats.staleFound).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('re-admits a frozen row the moment its card changes, and restarts the count', async () => {
    const info = 'A hopeless card.';
    await seedCharacter({ n: 53, characterInfo: info });
    await seedFailureState({
      n: 53,
      attempts: 5,
      failedHash: hashRosterBlurbCard(cardFor(53, info)),
      minutesAgo: 60,
    });

    // An edit, exactly as a write path performs it: the card fields and the
    // stamp move together.
    const editedInfo = 'Rewritten from scratch.';
    const editedHash = hashRosterBlurbCard(cardFor(53, editedInfo));
    await prisma.$executeRaw`
      UPDATE personalities
      SET character_info = ${editedInfo}, card_source_hash = ${editedHash}
      WHERE id = ${id(53)}::uuid
    `;

    const stats = await sweepRosterBlurbs(prisma, unparseableInvoker());

    expect(stats.staleFound).toBe(1);
    expect(stats.failedBilled).toBe(1);
    // The recorded failures were about a card that no longer exists, so the
    // count starts over against the new one rather than freezing it on arrival.
    const state = await failureState(53);
    expect(state.roster_blurb_attempts).toBe(1);
    expect(state.roster_blurb_failed_source_hash).toBe(editedHash);
  });

  it('stops re-billing a deterministically failing card after its first failure', async () => {
    const info = 'A card the model refuses.';
    await seedCharacter({ n: 54, characterInfo: info });

    const first = unparseableInvoker();
    const firstStats = await sweepRosterBlurbs(prisma, first);

    expect(firstStats.failedBilled).toBe(1);
    expect(first).toHaveBeenCalledTimes(1);
    const state = await failureState(54);
    expect(state.roster_blurb_attempts).toBe(1);
    expect(state.roster_blurb_failed_source_hash).toBe(hashRosterBlurbCard(cardFor(54, info)));
    expect(state.roster_blurb_last_failed_at).not.toBeNull();

    // The defect this whole gate exists for: the very next tick used to select
    // the same row and pay for the same refusal again, every ten minutes.
    const second = unparseableInvoker();
    const secondStats = await sweepRosterBlurbs(prisma, second);

    expect(secondStats.staleFound).toBe(0);
    expect(second).not.toHaveBeenCalled();
  });

  it('increments the count when the same unchanged card fails again after re-admission', async () => {
    const info = 'A card that keeps failing.';
    await seedCharacter({ n: 57, characterInfo: info });
    const hash = hashRosterBlurbCard(cardFor(57, info));
    await seedFailureState({ n: 57, attempts: 1, failedHash: hash, minutesAgo: 90 });

    const stats = await sweepRosterBlurbs(prisma, unparseableInvoker());

    expect(stats.failedBilled).toBe(1);
    // Same card, second billed failure: the stamp INCREMENTS rather than
    // restarting at 1. This is the branch that walks a deterministically
    // failing card toward the cap — without it the storm returns, just with a
    // one-hour period instead of a ten-minute one.
    const state = await failureState(57);
    expect(state.roster_blurb_attempts).toBe(2);
    expect(state.roster_blurb_failed_source_hash).toBe(hash);
  });

  it('clears failure state when a later generation finally succeeds', async () => {
    const info = 'A card that recovers.';
    await seedCharacter({ n: 55, characterInfo: info });
    await seedFailureState({
      n: 55,
      attempts: 3,
      failedHash: hashRosterBlurbCard(cardFor(55, info)),
      minutesAgo: 600,
    });

    const stats = await sweepRosterBlurbs(prisma, invoker());

    expect(stats.generated).toBe(1);
    const state = await failureState(55);
    expect(state.roster_blurb_attempts).toBe(0);
    expect(state.roster_blurb_last_failed_at).toBeNull();
    expect(state.roster_blurb_failed_source_hash).toBeNull();
  });

  it('leaves a never-failed row admitted with no waiting at all', async () => {
    // The gate must cost the happy path nothing: attempts=0 with a null failed
    // hash is admitted by the first arm, so the backoff arm is never consulted.
    await seedCharacter({ n: 56, characterInfo: 'A fresh character.' });

    const stats = await sweepRosterBlurbs(prisma, invoker());

    expect(stats.generated).toBe(1);
    const state = await failureState(56);
    expect(state.roster_blurb_attempts).toBe(0);
  });
});
