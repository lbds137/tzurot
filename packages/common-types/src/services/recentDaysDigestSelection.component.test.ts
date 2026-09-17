/**
 * Component test: recent-days digest candidate selection (real SQL).
 *
 * The selection's whole point is a set of SQL comparisons a mock cannot
 * model faithfully — `IS DISTINCT FROM` against nulls, a strict `>` on the
 * watermark, and an OR/AND clause structure where a manual refresh bypasses
 * one gate but not the other. These run against PGlite so the assertions are
 * about Postgres, not about a mock's assumptions.
 */

import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import { selectDigestCandidatePairs } from './recentDaysDigestSelection.js';

const OWNER_ID = '4f9b0f66-0000-4000-8000-0000000000a0';
const PERSONA_ID = '4f9b0f66-0000-4000-8000-0000000000a1';
const NOW = new Date('2026-09-17T12:00:00.000Z');
const PROMPT_VERSION = 1;

let pglite: PGlite;
let prisma: PrismaClient;

/** Maps a fixture letter to a stable 2-digit hex suffix so letters past 'f'
 *  (g, h, i, j — used by the ordering fixture) still produce a valid UUID. */
const LETTER_HEX: Record<string, string> = {
  a: '0a',
  b: '0b',
  c: '0c',
  d: '0d',
  e: '0e',
  f: '0f',
  g: '10',
  h: '11',
  i: '12',
  j: '13',
};

function personalityId(letter: string): string {
  const hex = LETTER_HEX[letter];
  if (hex === undefined) {
    throw new Error(`No fixture hex mapped for letter ${letter}`);
  }
  return `4f9b0f66-1111-4000-8000-0000000000${hex}`;
}

async function seedPersonality(letter: string, slug: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO personalities
      (id, name, slug, character_info, personality_traits, owner_id, updated_at)
    VALUES (${personalityId(letter)}::uuid, ${`Char ${letter}`}, ${slug}, 'info', 'traits',
            ${OWNER_ID}::uuid, NOW())
  `;
}

async function seedHistoryRow(letter: string, createdAt: Date): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO conversation_history
      (id, channel_id, personality_id, persona_id, role, content, created_at, updated_at)
    VALUES (gen_random_uuid(), '1', ${personalityId(letter)}::uuid, ${PERSONA_ID}::uuid,
            'user', 'hello', ${createdAt}::timestamptz, NOW())
  `;
}

interface DigestSeed {
  letter: string;
  status: string;
  attempts?: number;
  promptVersion: number;
  sourceWatermark: Date | null;
  generatedAt: Date | null;
  requestedAt: Date | null;
}

async function seedDigest(seed: DigestSeed): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO persona_personality_digests
      (id, persona_id, personality_id, digest_status, digest_attempts, digest_prompt_version,
       source_watermark, generated_at, requested_at, updated_at)
    VALUES (gen_random_uuid(), ${PERSONA_ID}::uuid, ${personalityId(seed.letter)}::uuid,
            ${seed.status}, ${seed.attempts ?? 0}, ${seed.promptVersion},
            ${seed.sourceWatermark}, ${seed.generatedAt}, ${seed.requestedAt}, NOW())
  `;
}

function hoursAgo(h: number): Date {
  return new Date(NOW.getTime() - h * 60 * 60_000);
}

function minutesAgo(m: number): Date {
  return new Date(NOW.getTime() - m * 60_000);
}

beforeAll(async () => {
  pglite = createTestPGlite();
  await pglite.exec(loadPGliteSchema());
  prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) });
  await seedUserWithPersona(prisma, {
    userId: OWNER_ID,
    personaId: PERSONA_ID,
    discordId: '200000000000000001',
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  await pglite.close();
});

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM persona_personality_digests`;
  await prisma.$executeRaw`DELETE FROM conversation_history`;
  await prisma.$executeRaw`DELETE FROM personalities`;
});

/**
 * The six pairs the canary enumerates. Each personality carries exactly one
 * source row, positioned relative to its own digest's watermark so the
 * per-case assertion isolates the clause it names.
 */
async function seedSixPairs(): Promise<void> {
  // (a) rows newer than watermark, generated 3h ago -> selected
  await seedPersonality('a', 'char-a');
  const newestA = hoursAgo(1);
  await seedHistoryRow('a', newestA);
  await seedDigest({
    letter: 'a',
    status: 'done',
    promptVersion: PROMPT_VERSION,
    sourceWatermark: new Date(newestA.getTime() - 1000),
    generatedAt: hoursAgo(3),
    requestedAt: null,
  });

  // (b) same but generated 30 min ago -> NOT selected (interval gate)
  await seedPersonality('b', 'char-b');
  const newestB = hoursAgo(1);
  await seedHistoryRow('b', newestB);
  await seedDigest({
    letter: 'b',
    status: 'done',
    promptVersion: PROMPT_VERSION,
    sourceWatermark: new Date(newestB.getTime() - 1000),
    generatedAt: minutesAgo(30),
    requestedAt: null,
  });

  // (c) generated 30 min ago, requested_at now -> selected (refresh bypasses interval)
  await seedPersonality('c', 'char-c');
  const newestC = hoursAgo(1);
  await seedHistoryRow('c', newestC);
  await seedDigest({
    letter: 'c',
    status: 'done',
    promptVersion: PROMPT_VERSION,
    sourceWatermark: newestC,
    generatedAt: minutesAgo(30),
    requestedAt: NOW,
  });

  // (d) personality not in the slug list passed to the query -> excluded
  await seedPersonality('d', 'char-d');
  await seedHistoryRow('d', hoursAgo(1));
  await seedDigest({
    letter: 'd',
    status: 'pending',
    promptVersion: PROMPT_VERSION,
    sourceWatermark: null,
    generatedAt: null,
    requestedAt: null,
  });

  // (e) dead, watermark EQUAL to the newest row -> NOT selected (strict >)
  await seedPersonality('e', 'char-e');
  const newestE = hoursAgo(1);
  await seedHistoryRow('e', newestE);
  await seedDigest({
    letter: 'e',
    status: 'dead',
    attempts: 3,
    promptVersion: PROMPT_VERSION,
    sourceWatermark: newestE,
    generatedAt: hoursAgo(3),
    requestedAt: null,
  });

  // (f) done, digest_prompt_version 0 (stale) -> selected on version mismatch
  await seedPersonality('f', 'char-f');
  const newestF = hoursAgo(1);
  await seedHistoryRow('f', newestF);
  await seedDigest({
    letter: 'f',
    status: 'done',
    promptVersion: 0,
    sourceWatermark: newestF,
    generatedAt: hoursAgo(3),
    requestedAt: null,
  });
}

describe('selectDigestCandidatePairs', () => {
  it('returns [] without querying when personalitySlugs is empty', async () => {
    const result = await selectDigestCandidatePairs(prisma, {
      personalitySlugs: [],
      promptVersion: PROMPT_VERSION,
      limit: 10,
      now: NOW,
    });
    expect(result).toEqual([]);
  });

  it('selects exactly (a), (c), (f) from the six-pair fixture', async () => {
    await seedSixPairs();
    const result = await selectDigestCandidatePairs(prisma, {
      personalitySlugs: ['char-a', 'char-b', 'char-c', 'char-e', 'char-f'],
      promptVersion: PROMPT_VERSION,
      limit: 10,
      now: NOW,
    });
    const slugs = result.map(r => r.personalitySlug).sort();
    expect(slugs).toEqual(['char-a', 'char-c', 'char-f']);
  });

  it('(a) rows newer than watermark, generated 3h ago -> selected', async () => {
    await seedSixPairs();
    const result = await selectDigestCandidatePairs(prisma, {
      personalitySlugs: ['char-a'],
      promptVersion: PROMPT_VERSION,
      limit: 10,
      now: NOW,
    });
    expect(result).toHaveLength(1);
  });

  it('(b) same but generated 30 min ago -> NOT selected', async () => {
    await seedSixPairs();
    const result = await selectDigestCandidatePairs(prisma, {
      personalitySlugs: ['char-b'],
      promptVersion: PROMPT_VERSION,
      limit: 10,
      now: NOW,
    });
    expect(result).toHaveLength(0);
  });

  it('(c) generated 30 min ago, requested_at now -> selected (refresh bypasses interval)', async () => {
    await seedSixPairs();
    const result = await selectDigestCandidatePairs(prisma, {
      personalitySlugs: ['char-c'],
      promptVersion: PROMPT_VERSION,
      limit: 10,
      now: NOW,
    });
    expect(result).toHaveLength(1);
  });

  it('(d) personality not in the slug list -> excluded even though its row and digest exist', async () => {
    await seedSixPairs();
    const result = await selectDigestCandidatePairs(prisma, {
      personalitySlugs: ['char-a', 'char-b', 'char-c', 'char-e', 'char-f'],
      promptVersion: PROMPT_VERSION,
      limit: 10,
      now: NOW,
    });
    expect(result.some(r => r.personalitySlug === 'char-d')).toBe(false);
  });

  it('(e) dead, watermark equal to the newest row -> NOT selected', async () => {
    await seedSixPairs();
    const result = await selectDigestCandidatePairs(prisma, {
      personalitySlugs: ['char-e'],
      promptVersion: PROMPT_VERSION,
      limit: 10,
      now: NOW,
    });
    expect(result).toHaveLength(0);
  });

  it('(f) done, prompt version 0 -> selected on version mismatch', async () => {
    await seedSixPairs();
    const result = await selectDigestCandidatePairs(prisma, {
      personalitySlugs: ['char-f'],
      promptVersion: PROMPT_VERSION,
      limit: 10,
      now: NOW,
    });
    expect(result).toHaveLength(1);
  });

  it('orders purge/refresh first, then never-generated, then oldest-generated-first', async () => {
    // never-generated pair
    await seedPersonality('g', 'char-g');
    await seedHistoryRow('g', hoursAgo(1));

    // older done pair, no refresh
    await seedPersonality('h', 'char-h');
    await seedHistoryRow('h', hoursAgo(1));
    await seedDigest({
      letter: 'h',
      status: 'done',
      promptVersion: 0,
      sourceWatermark: hoursAgo(1),
      generatedAt: hoursAgo(5),
      requestedAt: null,
    });

    // refreshed pair (requested_at > generated_at) — must sort first
    await seedPersonality('i', 'char-i');
    await seedHistoryRow('i', hoursAgo(1));
    await seedDigest({
      letter: 'i',
      status: 'done',
      promptVersion: PROMPT_VERSION,
      sourceWatermark: hoursAgo(1),
      generatedAt: hoursAgo(4),
      requestedAt: NOW,
    });

    const result = await selectDigestCandidatePairs(prisma, {
      personalitySlugs: ['char-g', 'char-h', 'char-i'],
      promptVersion: PROMPT_VERSION,
      limit: 10,
      now: NOW,
    });
    expect(result.map(r => r.personalitySlug)).toEqual(['char-i', 'char-g', 'char-h']);
  });

  it('respects the epoch: a row before the pair epoch does not count toward the window', async () => {
    await seedPersonality('j', 'char-j');
    const beforeEpoch = hoursAgo(2);
    await seedHistoryRow('j', beforeEpoch);
    await prisma.$executeRaw`
      INSERT INTO user_persona_history_configs
        (id, user_id, personality_id, persona_id, last_context_reset, updated_at)
      VALUES (gen_random_uuid(), ${OWNER_ID}::uuid, ${personalityId('j')}::uuid, ${PERSONA_ID}::uuid,
              ${NOW}::timestamptz, NOW())
    `;
    const result = await selectDigestCandidatePairs(prisma, {
      personalitySlugs: ['char-j'],
      promptVersion: PROMPT_VERSION,
      limit: 10,
      now: NOW,
    });
    expect(result).toHaveLength(0);
  });

  it('caps at limit', async () => {
    await seedSixPairs();
    const result = await selectDigestCandidatePairs(prisma, {
      personalitySlugs: ['char-a', 'char-b', 'char-c', 'char-e', 'char-f'],
      promptVersion: PROMPT_VERSION,
      limit: 1,
      now: NOW,
    });
    expect(result).toHaveLength(1);
  });
});
