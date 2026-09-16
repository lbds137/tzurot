/**
 * Component test: `FactStore.findSimilarActiveFacts`,
 * `FactStore.findReservedActiveFacts`, and
 * `FactStore.findActiveFactsBySourceMemoryIds` over REAL PGLite + pgvector.
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
import { FactRetriever } from '../FactRetriever.js';

const USER = '5a1c0f66-0000-4000-8000-00000000c001';
const PERSONA = '5a1c0f66-0000-4000-8000-00000000c002';
const OTHER_PERSONA = '5a1c0f66-0000-4000-8000-00000000c005';
const OTHER_USER = '5a1c0f66-0000-4000-8000-00000000c006';
const PERSONALITY = '5a1c0f66-0000-4000-8000-00000000c003';
const PERSONALITY_B = '5a1c0f66-0000-4000-8000-00000000c007';
const PERSONALITY_C = '5a1c0f66-0000-4000-8000-00000000c008';
const SYSTEM_PROMPT = '5a1c0f66-0000-4000-8000-00000000c004';

let seq = 0;
const nextId = (): string =>
  `5a1c0f66-0000-4000-8000-0000000000${(seq++).toString().padStart(2, '0')}`;

describe('FactStore (component, PGLite)', () => {
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
    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, display_name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES (${PERSONALITY_B}::uuid, 'QBotB', 'Q Bot B', 'qbot-b', ${SYSTEM_PROMPT}::uuid, 'Second character', 'Precise', ${USER}::uuid, NOW())
    `;
    // No display_name — the COALESCE fallback to `name` is what
    // authoring-personality columns tests (MEM-ARCH-032) exercise below.
    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES (${PERSONALITY_C}::uuid, 'QBotC', 'qbot-c', ${SYSTEM_PROMPT}::uuid, 'Third character', 'Precise', ${USER}::uuid, NOW())
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
    personalityId?: string;
    salience?: number;
    validFrom?: string;
    supersededAt?: string | null;
    forgotten?: boolean;
    visibility?: string;
    isLocked?: boolean;
    tier?: string;
    sourceMemoryIds?: string[];
    entityTags?: string[];
    /** Seed a NULL embedding column (a reservable fact whose embedding never
     * generated must still be reservable — findReservedActiveFacts has no
     * `embedding IS NOT NULL` guard). */
    nullEmbedding?: boolean;
  }

  async function seedFact(opts: SeedOpts): Promise<string> {
    const id = nextId();
    const personaId = opts.personaId === undefined ? PERSONA : opts.personaId;
    // The vector literal is inlined (not a placeholder) because the pglite
    // adapter's ::vector cast rejects a bound text parameter — mirrors
    // FactStore's own writes. NULL is inlined directly for nullEmbedding.
    let vecSql = 'NULL';
    if (!opts.nullEmbedding) {
      const vec = await embeddings.getEmbedding(opts.embedText);
      const vecLiteral = `[${Array.from(vec ?? []).join(',')}]`;
      vecSql = `'${vecLiteral}'::vector`;
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO memory_facts
         (id, personality_id, persona_id, statement, embedding, salience, valid_from,
          superseded_at, forgotten, visibility, is_locked, tier, source_memory_ids, entity_tags, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, ${vecSql}, $5, $6::timestamptz,
          $7::timestamptz, $8, $9, $10, $11, $12::text[], $13::text[], NOW(), NOW())`,
      id,
      opts.personalityId ?? PERSONALITY,
      personaId,
      opts.statement,
      opts.salience ?? 0.5,
      opts.validFrom ?? '2026-01-01T00:00:00Z',
      opts.supersededAt ?? null,
      opts.forgotten ?? false,
      opts.visibility ?? 'normal',
      opts.isLocked ?? false,
      opts.tier ?? 'observed',
      opts.sourceMemoryIds ?? [],
      opts.entityTags ?? []
    );
    return id;
  }

  async function queryFor(text: string, personaId: string | null = PERSONA, limit = 5) {
    const vec = await embeddings.getEmbedding(text);
    return factStore.findSimilarActiveFacts(Array.from(vec ?? []), PERSONALITY, personaId, limit);
  }

  it("personalityId=null widens to ALL of the persona's personalities (sharing flag)", async () => {
    await seedFact({
      statement: 'The user has a cat named Miso',
      embedText: 'The user has a cat named Miso',
    });
    await seedFact({
      statement: 'The user has a cat that likes yarn',
      embedText: 'The user has a cat that likes yarn',
      personalityId: PERSONALITY_B,
    });
    const vec = await embeddings.getEmbedding('cat facts about the user');
    const scoped = await factStore.findSimilarActiveFacts(
      Array.from(vec ?? []),
      PERSONALITY,
      PERSONA,
      5
    );
    expect(scoped.map(f => f.statement)).toEqual(['The user has a cat named Miso']);

    const widened = await factStore.findSimilarActiveFacts(Array.from(vec ?? []), null, PERSONA, 5);
    expect(widened.map(f => f.statement).sort()).toEqual([
      'The user has a cat named Miso',
      'The user has a cat that likes yarn',
    ]);
  });

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
  async function extractionSupersede(
    newStatement: string,
    targetId: string,
    validFrom = new Date('2026-04-01T00:00:00.000Z')
  ): Promise<string> {
    const vec = await embeddings.getEmbedding(newStatement);
    return factStore.writeFactWithSupersessions(
      {
        personalityId: PERSONALITY,
        personaId: PERSONA,
        statement: newStatement,
        entityTags: ['user'],
        salience: 0.5,
        isFiction: false,
        sourceMemoryIds: [],
        extractionJobId: 'job-guard',
        validFrom,
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

  it('writes valid_from as the provided EVIDENCE time, not the write time', async () => {
    const evidenceTime = new Date('2025-11-03T00:00:00.000Z');
    const anchorId = await seedFact({ statement: 'anchor', embedText: 'anchor' });

    const id = await extractionSupersede('The user adopted a greyhound', anchorId, evidenceTime);

    const row = await prisma.memoryFact.findUnique({ where: { id } });
    expect(row?.validFrom).toEqual(evidenceTime);
    // created_at stays a real write-time stamp — only valid_from carries
    // evidence-time semantics.
    expect(row?.createdAt.getTime()).toBeGreaterThan(evidenceTime.getTime());
  });

  it('revival refreshes valid_from to the NEW evidence time', async () => {
    // Seattle→Denver→Seattle: the revived Seattle fact must carry the
    // re-assertion's evidence time, not its original (older) one.
    const anchorId = await seedFact({ statement: 'revival anchor', embedText: 'revival anchor' });
    const seattleId = await extractionSupersede(
      'The user lives in Seattle',
      anchorId,
      new Date('2025-01-01T00:00:00.000Z')
    );
    await extractionSupersede('The user lives in Denver', seattleId);
    const dead = await prisma.memoryFact.findUnique({ where: { id: seattleId } });
    expect(dead?.supersededAt).not.toBeNull(); // precondition: Seattle is superseded

    const revivalTime = new Date('2026-06-15T00:00:00.000Z');
    const revivedId = await extractionSupersede('The user lives in Seattle', anchorId, revivalTime);

    expect(revivedId).toBe(seattleId); // content-hash id collides → revival path
    const revived = await prisma.memoryFact.findUnique({ where: { id: seattleId } });
    expect(revived?.supersededAt).toBeNull();
    expect(revived?.validFrom).toEqual(revivalTime);
  });

  it('revives a cascade-deleted fact on fresh evidence — carrying only the NEW sources', async () => {
    // Re-telling a fact in a new conversation is freely-given new evidence; the
    // memory-deletion cascade must not make it unlearnable. Source replacement
    // is load-bearing: the revived row cites only the new memory, so the
    // cascade's self-heal sweep won't re-kill it over the deleted original.
    const anchorId = await seedFact({ statement: 'cascade anchor', embedText: 'cascade anchor' });
    const factId = await extractionSupersede('The user plays the harp', anchorId);
    await prisma.$executeRaw`UPDATE memory_facts SET visibility = 'deleted' WHERE id = ${factId}::uuid`;

    const newSourceMemory = '30000000-0000-0000-0000-000000000001';
    const vec = await embeddings.getEmbedding('The user plays the harp');
    const revivedId = await factStore.writeFactWithSupersessions(
      {
        personalityId: PERSONALITY,
        personaId: PERSONA,
        statement: 'The user plays the harp',
        entityTags: ['user'],
        salience: 0.5,
        isFiction: false,
        sourceMemoryIds: [newSourceMemory],
        extractionJobId: 'job-revival',
        validFrom: new Date('2026-06-20T00:00:00.000Z'),
      },
      [],
      Array.from(vec ?? [])
    );

    expect(revivedId).toBe(factId); // content-hash id collides → revival path
    const revived = await prisma.memoryFact.findUnique({ where: { id: factId } });
    expect(revived?.visibility).toBe('normal');
    expect(revived?.sourceMemoryIds).toEqual([newSourceMemory]);
  });

  it('a FORGOTTEN fact stays dead even when its row is also cascade-deleted', async () => {
    // The visibility disjunct WIDENED the revival WHERE; this pins that the
    // forgotten=false conjunct still holds against it — user removal is
    // terminal no matter which dead-state the row is in.
    const anchorId = await seedFact({ statement: 'forget anchor', embedText: 'forget anchor' });
    const factId = await extractionSupersede('The user hates cilantro', anchorId);
    await prisma.$executeRaw`
      UPDATE memory_facts SET forgotten = true, visibility = 'deleted' WHERE id = ${factId}::uuid
    `;

    await extractionSupersede('The user hates cilantro', anchorId);

    const row = await prisma.memoryFact.findUnique({ where: { id: factId } });
    expect(row?.visibility).toBe('deleted'); // not revived
    expect(row?.forgotten).toBe(true);
  });

  describe('findReservedActiveFacts', () => {
    it('selects a LOCKED fact even with no similarity to any query', async () => {
      const id = await seedFact({
        statement: 'a locked reserved fact',
        embedText: 'a locked reserved fact',
        isLocked: true,
      });

      const hits = await factStore.findReservedActiveFacts(PERSONALITY, PERSONA, 3);

      expect(hits.map(h => h.id)).toEqual([id]);
    });

    it('selects a CORRECTED-tier fact', async () => {
      const id = await seedFact({
        statement: 'a corrected reserved fact',
        embedText: 'a corrected reserved fact',
        tier: 'corrected',
      });

      const hits = await factStore.findReservedActiveFacts(PERSONALITY, PERSONA, 3);

      expect(hits.map(h => h.id)).toEqual([id]);
    });

    it('selects a fact tagged commitment:address', async () => {
      const id = await seedFact({
        statement: 'lives at 123 Main St',
        embedText: 'lives at 123 Main St',
        entityTags: ['commitment:address'],
      });

      const hits = await factStore.findReservedActiveFacts(PERSONALITY, PERSONA, 3);

      expect(hits.map(h => h.id)).toEqual([id]);
    });

    it('does NOT select a plain observed, unlocked, untagged fact', async () => {
      await seedFact({
        statement: 'a completely ordinary fact',
        embedText: 'a completely ordinary fact',
      });

      const hits = await factStore.findReservedActiveFacts(PERSONALITY, PERSONA, 3);

      expect(hits).toEqual([]);
    });

    it.each(['commitment:promise', 'commitment:decision', 'commitment:advice'])(
      'does NOT select a fact tagged %s — deliberate non-widening',
      async tag => {
        await seedFact({
          statement: `a fact tagged ${tag}`,
          embedText: `a fact tagged ${tag}`,
          entityTags: [tag],
        });

        const hits = await factStore.findReservedActiveFacts(PERSONALITY, PERSONA, 3);

        expect(hits).toEqual([]);
      }
    );

    it('excludes a superseded reserved-class fact', async () => {
      await seedFact({
        statement: 'a superseded locked fact',
        embedText: 'a superseded locked fact',
        isLocked: true,
        supersededAt: '2026-05-01T00:00:00Z',
      });

      expect(await factStore.findReservedActiveFacts(PERSONALITY, PERSONA, 3)).toEqual([]);
    });

    it('excludes a forgotten reserved-class fact', async () => {
      await seedFact({
        statement: 'a forgotten locked fact',
        embedText: 'a forgotten locked fact',
        isLocked: true,
        forgotten: true,
      });

      expect(await factStore.findReservedActiveFacts(PERSONALITY, PERSONA, 3)).toEqual([]);
    });

    it('excludes a cascade-deleted (visibility != normal) reserved-class fact', async () => {
      await seedFact({
        statement: 'a deleted locked fact',
        embedText: 'a deleted locked fact',
        isLocked: true,
        visibility: 'deleted',
      });

      expect(await factStore.findReservedActiveFacts(PERSONALITY, PERSONA, 3)).toEqual([]);
    });

    it('returns a reserved-class fact with a NULL embedding', async () => {
      const id = await seedFact({
        statement: 'a locked fact with no embedding yet',
        embedText: 'unused',
        isLocked: true,
        nullEmbedding: true,
      });

      const hits = await factStore.findReservedActiveFacts(PERSONALITY, PERSONA, 3);

      expect(hits.map(h => h.id)).toEqual([id]);
    });

    it('orders by class priority: locked, then corrected, then address-tagged', async () => {
      const addressId = await seedFact({
        statement: 'address-tagged fact',
        embedText: 'address-tagged fact',
        entityTags: ['commitment:address'],
        salience: 0.9,
        validFrom: '2026-06-01T00:00:00Z',
      });
      const correctedId = await seedFact({
        statement: 'corrected fact',
        embedText: 'corrected fact',
        tier: 'corrected',
        salience: 0.1,
        validFrom: '2025-01-01T00:00:00Z',
      });
      const lockedId = await seedFact({
        statement: 'locked fact',
        embedText: 'locked fact',
        isLocked: true,
        salience: 0.1,
        validFrom: '2025-01-01T00:00:00Z',
      });

      const hits = await factStore.findReservedActiveFacts(PERSONALITY, PERSONA, 3);

      expect(hits.map(h => h.id)).toEqual([lockedId, correctedId, addressId]);
    });

    it('within one class, orders by salience DESC then valid_from DESC', async () => {
      const lowSalienceOlder = await seedFact({
        statement: 'locked, low salience, older',
        embedText: 'locked, low salience, older',
        isLocked: true,
        salience: 0.1,
        validFrom: '2025-01-01T00:00:00Z',
      });
      const highSalience = await seedFact({
        statement: 'locked, high salience',
        embedText: 'locked, high salience',
        isLocked: true,
        salience: 0.9,
        validFrom: '2025-01-01T00:00:00Z',
      });
      const sameSalienceNewer = await seedFact({
        statement: 'locked, high salience, newer',
        embedText: 'locked, high salience, newer',
        isLocked: true,
        salience: 0.9,
        validFrom: '2026-06-01T00:00:00Z',
      });

      const hits = await factStore.findReservedActiveFacts(PERSONALITY, PERSONA, 3);

      expect(hits.map(h => h.id)).toEqual([sameSalienceNewer, highSalience, lowSalienceOlder]);
    });

    it('respects the LIMIT', async () => {
      await seedFact({ statement: 'locked 1', embedText: 'locked 1', isLocked: true });
      await seedFact({ statement: 'locked 2', embedText: 'locked 2', isLocked: true });
      await seedFact({ statement: 'locked 3', embedText: 'locked 3', isLocked: true });

      const hits = await factStore.findReservedActiveFacts(PERSONALITY, PERSONA, 2);

      expect(hits).toHaveLength(2);
    });

    it('personaId=null returns only persona_id IS NULL rows (no leak from a real persona)', async () => {
      await seedFact({
        statement: 'a locked fact owned by a real persona',
        embedText: 'a locked fact owned by a real persona',
        isLocked: true,
        personaId: PERSONA,
      });
      const worldId = await seedFact({
        statement: 'a locked world/canon fact',
        embedText: 'a locked world/canon fact',
        isLocked: true,
        personaId: null,
      });

      const hits = await factStore.findReservedActiveFacts(PERSONALITY, null, 3);

      expect(hits.map(h => h.id)).toEqual([worldId]);
    });

    it("personalityId=null widens across ALL of the persona's personalities", async () => {
      const idA = await seedFact({
        statement: 'locked fact on personality A',
        embedText: 'locked fact on personality A',
        isLocked: true,
        personalityId: PERSONALITY,
      });
      const idB = await seedFact({
        statement: 'locked fact on personality B',
        embedText: 'locked fact on personality B',
        isLocked: true,
        personalityId: PERSONALITY_B,
      });

      const hits = await factStore.findReservedActiveFacts(null, PERSONA, 5);

      expect(hits.map(h => h.id).sort()).toEqual([idA, idB].sort());
    });
  });

  describe('findActiveFactsBySourceMemoryIds', () => {
    it('MEM-ARCH-007: linked facts exclude deleted, forgotten, and superseded rows', async () => {
      const sourceMemoryId = '40000000-0000-0000-0000-000000000001';

      await seedFact({
        statement: 'the active linked fact',
        embedText: 'the active linked fact',
        sourceMemoryIds: [sourceMemoryId],
      });
      await seedFact({
        statement: 'a cascade-deleted linked fact',
        embedText: 'a cascade-deleted linked fact',
        sourceMemoryIds: [sourceMemoryId],
        visibility: 'deleted',
      });
      await seedFact({
        statement: 'a forgotten linked fact',
        embedText: 'a forgotten linked fact',
        sourceMemoryIds: [sourceMemoryId],
        forgotten: true,
      });
      await seedFact({
        statement: 'a superseded linked fact',
        embedText: 'a superseded linked fact',
        sourceMemoryIds: [sourceMemoryId],
        supersededAt: '2026-05-01T00:00:00Z',
      });

      const linked = await factStore.findActiveFactsBySourceMemoryIds(
        [sourceMemoryId],
        PERSONALITY
      );

      expect(linked).toHaveLength(1);
      expect(linked[0].statement).toBe('the active linked fact');
      expect(linked[0]).toMatchObject({
        id: expect.any(String),
        statement: 'the active linked fact',
        salience: 0.5,
        sourceMemoryIds: [sourceMemoryId],
      });
    });

    it('short-circuits to [] for an empty memoryIds array', async () => {
      const result = await factStore.findActiveFactsBySourceMemoryIds([], PERSONALITY);
      expect(result).toEqual([]);
    });

    it('excludes a fact belonging to a DIFFERENT personality', async () => {
      const sourceMemoryId = '40000000-0000-0000-0000-000000000002';
      await seedFact({
        statement: 'fact for personality B',
        embedText: 'fact for personality B',
        sourceMemoryIds: [sourceMemoryId],
        personalityId: PERSONALITY_B,
      });

      const linked = await factStore.findActiveFactsBySourceMemoryIds(
        [sourceMemoryId],
        PERSONALITY
      );

      expect(linked).toEqual([]);
    });
  });

  /**
   * The wiring/seam test (02-code-standards.md § 7) for the
   * `FactRetriever` → `FactStore` → SQL chain. The two tiers around it each
   * verify only their own half: `FactRetriever.test.ts` hands the merge a
   * hand-built mock `FactStore`, so the merge never sees a real row shape, and
   * the suites above drive `findReservedActiveFacts` directly, so the SQL is
   * verified but its consumer is not. Nothing is mocked here — a real
   * `FactStore` over real PGLite, a real `LocalEmbeddingService`, and the real
   * `FactRetriever` — so a row-mapping break between the SQL's snake_case
   * columns and `SimilarFact`'s camelCase fields fails here and nowhere else.
   */
  describe('FactRetriever → FactStore seam (nothing mocked)', () => {
    const SEAM_QUERY = 'what time is the standup meeting tomorrow morning';
    const SEAM_LIMIT = 4;
    /** Far enough from SEAM_QUERY that similarity alone can never surface it:
     *  measured cosine similarity 0.38 against the query, versus 0.62–0.76 for
     *  the four decoys below. With SEAM_LIMIT decoys filling every slot it
     *  ranks last of five — strictly inside the falsifying region rather than
     *  on its boundary, which the margin assertion below pins rather than
     *  assumes. */
    const RESERVED_STATEMENT = 'Lila addresses Emily as her angelic girlfriend';
    const RESERVED_TAGS = ['commitment:address', 'person:emily'];

    it('surfaces a far-from-query reserved fact FIRST, with every field mapped from real columns', async () => {
      // Every asserted field below is seeded to a NON-default value (is_locked
      // defaults false, tier defaults 'observed', entity_tags defaults []), so
      // no assertion can pass off a mis-mapped column as the expected value.
      const reservedId = await seedFact({
        statement: RESERVED_STATEMENT,
        embedText: RESERVED_STATEMENT,
        entityTags: RESERVED_TAGS,
        isLocked: true,
        tier: 'corrected',
      });
      // SEAM_LIMIT decoys, all closer to the query than the reserved fact, so
      // the similarity path alone fills every slot without it.
      for (const decoy of [
        'The user schedules the daily standup at 9am',
        'The user prefers morning meetings over afternoon ones',
        'The user moved tomorrow meeting to a later slot',
        'The user keeps a calendar reminder for every standup',
      ]) {
        await seedFact({ statement: decoy, embedText: decoy });
      }

      const queryVec = Array.from((await embeddings.getEmbedding(SEAM_QUERY)) ?? []);
      const similarityOnly = await factStore.findSimilarActiveFacts(
        queryVec,
        PERSONALITY,
        PERSONA,
        SEAM_LIMIT
      );
      // Precondition: the reserved fact is genuinely unreachable by similarity
      // at this limit — otherwise the test would pass through the similarity
      // path by accident and verify nothing about the reservation.
      expect(similarityOnly).toHaveLength(SEAM_LIMIT);
      expect(similarityOnly.map(f => f.id)).not.toContain(reservedId);

      // ...and it is outside the cut by a wide margin, not sitting on it.
      const allFive = await factStore.findSimilarActiveFacts(queryVec, PERSONALITY, PERSONA, 10);
      const reservedSimilarity = allFive.find(f => f.id === reservedId)?.similarity ?? 1;
      const weakestIncluded = similarityOnly[similarityOnly.length - 1].similarity;
      expect(reservedSimilarity).toBeLessThan(weakestIncluded - 0.15);

      const facts = await new FactRetriever(factStore).retrieveFacts(
        SEAM_QUERY,
        PERSONALITY,
        PERSONA,
        SEAM_LIMIT
      );

      // The reserved fact leads, and it displaces the weakest similarity hit
      // rather than extending the list past the limit.
      expect(facts.map(f => f.id)).toEqual([
        reservedId,
        ...similarityOnly.slice(0, SEAM_LIMIT - 1).map(f => f.id),
      ]);
      // The half that catches a column-mapping break: these values came out of
      // real SQL rows, not a mock object the unit suite hand-built.
      expect(facts[0]).toMatchObject({
        id: reservedId,
        statement: RESERVED_STATEMENT,
        entityTags: RESERVED_TAGS,
        isLocked: true,
        tier: 'corrected',
        reserved: true,
      });
    });
  });

  describe('authoring-personality columns (MEM-ARCH-032)', () => {
    it('MEM-ARCH-032: both prompt-path queries carry the authoring personality id and COALESCEd name', async () => {
      const statementA = 'QBot statement for authorship column test';
      const statementC = 'QBotC statement for authorship column test';
      await seedFact({
        statement: statementA,
        embedText: statementA,
        personalityId: PERSONALITY,
      });
      await seedFact({
        statement: statementC,
        embedText: statementC,
        personalityId: PERSONALITY_C,
      });

      const vec = Array.from((await embeddings.getEmbedding('authorship column test')) ?? []);
      const similarRows = await factStore.findSimilarActiveFacts(vec, null, PERSONA, 10);

      const rowA = similarRows.find(f => f.statement === statementA);
      const rowC = similarRows.find(f => f.statement === statementC);
      expect(rowA).toMatchObject({ personalityId: PERSONALITY, personalityName: 'Q Bot' });
      expect(rowC).toMatchObject({ personalityId: PERSONALITY_C, personalityName: 'QBotC' });
    });

    it('MEM-ARCH-032: findReservedActiveFacts carries the authoring personality id and COALESCEd name', async () => {
      const statementA = 'QBot reserved statement for authorship column test';
      const statementC = 'QBotC reserved statement for authorship column test';
      await seedFact({
        statement: statementA,
        embedText: statementA,
        personalityId: PERSONALITY,
        isLocked: true,
      });
      await seedFact({
        statement: statementC,
        embedText: statementC,
        personalityId: PERSONALITY_C,
        isLocked: true,
      });

      const reservedRows = await factStore.findReservedActiveFacts(null, PERSONA, 10);

      const rowA = reservedRows.find(f => f.statement === statementA);
      const rowC = reservedRows.find(f => f.statement === statementC);
      expect(rowA).toMatchObject({ personalityId: PERSONALITY, personalityName: 'Q Bot' });
      expect(rowC).toMatchObject({ personalityId: PERSONALITY_C, personalityName: 'QBotC' });
    });
  });
});
