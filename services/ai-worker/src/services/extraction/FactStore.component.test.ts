/**
 * Component test: `FactStore.findSimilarActiveFacts` over REAL PGLite + pgvector.
 *
 * The unit suite (`FactStore.test.ts`) mocks `$queryRaw`, so the actual retrieval
 * SQL — the `embedding <=>` distance, the `valid_from DESC, salience DESC`
 * tiebreak, and every active-filter (`superseded_at`/`forgotten`/`visibility`/
 * persona scope) — never executes there. This test runs that SQL against the
 * real schema so a composition regression (a dropped filter, a broken tiebreak
 * clause) fails in CI instead of only at runtime. The query now serves two
 * callers (extraction supersession fallback + generation-time `FactRetriever`),
 * which raises the cost of a silent SQL break.
 *
 * Facts are seeded via raw SQL so the test controls the embedding vector,
 * `valid_from`, and `salience` precisely — the only way to force EXACTLY equal
 * cosine distance (identical embeddings) and prove the tiebreak is what orders
 * the rows, not a distance difference.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { LocalEmbeddingService } from '@tzurot/embeddings';
import { FactStore } from './FactStore.js';

const USER = '5a1c0f66-0000-4000-8000-00000000c001';
const PERSONA = '5a1c0f66-0000-4000-8000-00000000c002';
const OTHER_PERSONA = '5a1c0f66-0000-4000-8000-00000000c005';
const OTHER_USER = '5a1c0f66-0000-4000-8000-00000000c006';
const PERSONALITY = '5a1c0f66-0000-4000-8000-00000000c003';
const SYSTEM_PROMPT = '5a1c0f66-0000-4000-8000-00000000c004';

let seq = 0;
const nextId = (): string =>
  `5a1c0f66-0000-4000-8000-0000000000${(seq++).toString().padStart(2, '0')}`;

describe('FactStore.findSimilarActiveFacts (component, PGLite)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;
  let embeddings: LocalEmbeddingService;
  let factStore: FactStore;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;

    await seedUserWithPersona(prisma, {
      userId: USER,
      personaId: PERSONA,
      discordId: '900000000000000051',
      username: 'factqueryuser',
      personaName: 'Query Persona',
      personaPreferredName: 'Query',
      personaContent: 'The fact-retrieval persona',
    });
    await seedUserWithPersona(prisma, {
      userId: OTHER_USER,
      personaId: OTHER_PERSONA,
      discordId: '900000000000000052',
      username: 'otherfactuser',
      personaName: 'Other Persona',
      personaPreferredName: 'Other',
      personaContent: 'The scope-isolation persona',
    });
    await prisma.$executeRaw`
      INSERT INTO system_prompts (id, name, content, updated_at)
      VALUES (${SYSTEM_PROMPT}::uuid, 'Q Prompt', 'You are a fact bot.', NOW())
    `;
    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, display_name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES (${PERSONALITY}::uuid, 'QBot', 'Q Bot', 'qbot', ${SYSTEM_PROMPT}::uuid, 'Q character', 'Precise', ${USER}::uuid, NOW())
    `;

    embeddings = new LocalEmbeddingService();
    const ready = await embeddings.initialize();
    if (!ready) {
      throw new Error('Local embedding model failed to initialize');
    }
    factStore = new FactStore(prisma, embeddings);
  }, 180_000);

  afterAll(async () => {
    await embeddings.shutdown();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM memory_facts`;
  });

  interface SeedOpts {
    statement: string;
    /** Text whose embedding becomes this fact's vector (controls distance). */
    embedText: string;
    personaId?: string | null;
    salience?: number;
    validFrom?: string;
    supersededAt?: string | null;
    forgotten?: boolean;
    visibility?: string;
    isLocked?: boolean;
    tier?: string;
  }

  async function seedFact(opts: SeedOpts): Promise<string> {
    const id = nextId();
    const vec = await embeddings.getEmbedding(opts.embedText);
    const vecLiteral = `[${Array.from(vec ?? []).join(',')}]`;
    const personaId = opts.personaId === undefined ? PERSONA : opts.personaId;
    await prisma.$executeRawUnsafe(
      `INSERT INTO memory_facts
         (id, personality_id, persona_id, statement, embedding, salience, valid_from,
          superseded_at, forgotten, visibility, is_locked, tier, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, '${vecLiteral}'::vector, $5, $6::timestamptz,
          $7::timestamptz, $8, $9, $10, $11, NOW(), NOW())`,
      id,
      PERSONALITY,
      personaId,
      opts.statement,
      opts.salience ?? 0.5,
      opts.validFrom ?? '2026-01-01T00:00:00Z',
      opts.supersededAt ?? null,
      opts.forgotten ?? false,
      opts.visibility ?? 'normal',
      opts.isLocked ?? false,
      opts.tier ?? 'observed'
    );
    return id;
  }

  async function queryFor(text: string, personaId: string | null = PERSONA, limit = 5) {
    const vec = await embeddings.getEmbedding(text);
    return factStore.findSimilarActiveFacts(Array.from(vec ?? []), PERSONALITY, personaId, limit);
  }

  it('ranks by cosine similarity and returns similarity in [0,1]', async () => {
    await seedFact({
      statement: 'The user has a cat named Miso',
      embedText: 'The user has a cat named Miso',
    });
    await seedFact({
      statement: 'The kingdom of Veyra has three great cities',
      embedText: 'The kingdom of Veyra has three great cities',
    });

    const hits = await queryFor("the user's pet cat");

    expect(hits.length).toBe(2);
    expect(hits[0].statement).toBe('The user has a cat named Miso');
    // Similarity is 1 - cosine distance, so the closer fact scores higher.
    expect(hits[0].similarity).toBeGreaterThan(hits[1].similarity);
    expect(hits[0].similarity).toBeGreaterThanOrEqual(0);
    expect(hits[0].similarity).toBeLessThanOrEqual(1);
  });

  it('tiebreak: among EQUAL-distance facts the more recent valid_from wins', async () => {
    // Identical embedding → identical distance → the ORDER BY falls entirely to
    // the valid_from tiebreak. This is the exact clause the review flagged as
    // never exercised against a real DB.
    const shared = 'The user lives in a city';
    await seedFact({
      statement: 'The user lives in Seattle',
      embedText: shared,
      validFrom: '2026-01-01T00:00:00Z',
      salience: 0.9,
    });
    await seedFact({
      statement: 'The user lives in Denver',
      embedText: shared,
      validFrom: '2026-06-01T00:00:00Z',
      salience: 0.1, // lower salience — proves valid_from outranks salience
    });

    const hits = await queryFor(shared);

    expect(hits.map(h => h.statement)).toEqual([
      'The user lives in Denver', // newer valid_from, despite lower salience
      'The user lives in Seattle',
    ]);
  });

  it('tiebreak: at equal distance AND equal valid_from, higher salience wins', async () => {
    const shared = 'The user enjoys a hobby';
    await seedFact({
      statement: 'The user enjoys pottery',
      embedText: shared,
      validFrom: '2026-03-01T00:00:00Z',
      salience: 0.3,
    });
    await seedFact({
      statement: 'The user enjoys chess',
      embedText: shared,
      validFrom: '2026-03-01T00:00:00Z',
      salience: 0.8,
    });

    const hits = await queryFor(shared);

    expect(hits[0].statement).toBe('The user enjoys chess'); // higher salience
  });

  it('excludes superseded, forgotten, and soft-deleted facts', async () => {
    const shared = 'A fact about the user';
    await seedFact({ statement: 'active fact', embedText: shared });
    await seedFact({
      statement: 'superseded fact',
      embedText: shared,
      supersededAt: '2026-05-01T00:00:00Z',
    });
    await seedFact({ statement: 'forgotten fact', embedText: shared, forgotten: true });
    await seedFact({ statement: 'deleted fact', embedText: shared, visibility: 'deleted' });

    const hits = await queryFor(shared);

    expect(hits.map(h => h.statement)).toEqual(['active fact']);
  });

  it('scopes to the given persona (and to null-persona facts when personaId is null)', async () => {
    const shared = 'A scoped fact';
    await seedFact({ statement: 'main persona fact', embedText: shared, personaId: PERSONA });
    await seedFact({
      statement: 'other persona fact',
      embedText: shared,
      personaId: OTHER_PERSONA,
    });
    await seedFact({ statement: 'world fact (no persona)', embedText: shared, personaId: null });

    const mainHits = await queryFor(shared, PERSONA);
    expect(mainHits.map(h => h.statement)).toEqual(['main persona fact']);

    const worldHits = await queryFor(shared, null);
    expect(worldHits.map(h => h.statement)).toEqual(['world fact (no persona)']);
  });

  it('surfaces isLocked so downstream (the correction slice) can respect it', async () => {
    await seedFact({ statement: 'a locked fact', embedText: 'a locked fact', isLocked: true });

    const hits = await queryFor('a locked fact');

    expect(hits[0].isLocked).toBe(true);
  });

  // The updateMany lock/forgotten guard (correction slice): once user correction
  // produces locked facts, extraction must NEVER auto-supersede one. Exercises
  // the real transaction against the DB — a mocked $queryRaw can't catch a
  // dropped WHERE predicate.
  async function extractionSupersede(newStatement: string, targetId: string): Promise<void> {
    const vec = await embeddings.getEmbedding(newStatement);
    await factStore.writeFactWithSupersessions(
      {
        personalityId: PERSONALITY,
        personaId: PERSONA,
        statement: newStatement,
        entityTags: ['user'],
        salience: 0.5,
        isFiction: false,
        sourceMemoryIds: [],
        extractionJobId: 'job-guard',
      },
      [targetId],
      Array.from(vec ?? [])
    );
  }

  it('extraction never supersedes a LOCKED fact (updateMany guard holds)', async () => {
    const lockedId = await seedFact({
      statement: 'The user lives in Seattle',
      embedText: 'The user lives in Seattle',
      isLocked: true,
    });

    await extractionSupersede('The user lives in Denver', lockedId);

    const locked = await prisma.memoryFact.findUnique({ where: { id: lockedId } });
    expect(locked?.supersededAt).toBeNull(); // still active — the lock protected it
  });

  it('extraction supersedes an UNLOCKED fact normally (guard is scoped)', async () => {
    const unlockedId = await seedFact({
      statement: 'The user lives in Boston',
      embedText: 'The user lives in Boston',
    });

    await extractionSupersede('The user lives in Austin', unlockedId);

    const unlocked = await prisma.memoryFact.findUnique({ where: { id: unlockedId } });
    expect(unlocked?.supersededAt).not.toBeNull(); // superseded — guard only shields protected rows
  });

  it('extraction never supersedes a user-authored CORRECTED fact (tier guard holds)', async () => {
    // A correction is unlocked (no unlock ceremony to re-correct), so the TIER
    // is what must hold at the DB level against extraction supersession.
    const correctedId = await seedFact({
      statement: 'The user lives in Denver',
      embedText: 'The user lives in Denver',
      tier: 'corrected',
    });

    await extractionSupersede('The user lives in Chicago', correctedId);

    const corrected = await prisma.memoryFact.findUnique({ where: { id: correctedId } });
    expect(corrected?.supersededAt).toBeNull(); // still active — user assertion outranks the model
  });
});
