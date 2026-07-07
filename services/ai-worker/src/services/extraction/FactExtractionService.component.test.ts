/**
 * Component test: the full extraction flow over REAL PGLite + pgvector.
 *
 * Mocks ONLY the external boundary (the extraction model call) — episodes,
 * fact writes, the supersession transaction, and the similarity fallback all
 * run against the real schema. This is the wiring test the unit suite can't
 * be: it proves the raw INSERT actually satisfies memory_facts' DDL, the
 * updateMany actually flips supersession columns, and the fallback query's
 * SQL is valid pgvector.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { type PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { LocalEmbeddingService } from '@tzurot/embeddings';
import { JobType } from '@tzurot/common-types/constants/queue';
import type { FactExtractionJobData } from '@tzurot/common-types/types/jobs';
import { deterministicMemoryUuid } from '@tzurot/common-types/constants/memory';
import type { Redis } from 'ioredis';
import { FactExtractionService } from './FactExtractionService.js';
import { FactStore } from './FactStore.js';
import { ExtractionBudget } from './ExtractionBudget.js';

const USER = '4f9b0f66-0000-4000-8000-00000000f001';
const PERSONA = '4f9b0f66-0000-4000-8000-00000000f002';
const PERSONALITY = '4f9b0f66-0000-4000-8000-00000000f003';
const SYSTEM_PROMPT = '4f9b0f66-0000-4000-8000-00000000f004';

describe('FactExtractionService (component, PGLite)', () => {
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
      discordId: '900000000000000042',
      username: 'factuser',
      personaName: 'Fact Persona',
      personaPreferredName: 'Facty',
      personaContent: 'The fact-extraction persona',
    });
    await prisma.$executeRaw`
      INSERT INTO system_prompts (id, name, content, updated_at)
      VALUES (${SYSTEM_PROMPT}::uuid, 'Fact Prompt', 'You are a fact bot.', NOW())
    `;
    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, display_name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES (${PERSONALITY}::uuid, 'FactBot', 'Fact Bot', 'factbot', ${SYSTEM_PROMPT}::uuid, 'Fact character', 'Precise', ${USER}::uuid, NOW())
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
    await prisma.$executeRaw`DELETE FROM memories`;
  });

  function makeBudget(allowed = true): ExtractionBudget {
    const redis = {
      eval: vi.fn().mockResolvedValue(allowed ? 1 : 9999),
    } as unknown as Redis;
    return new ExtractionBudget(redis, allowed ? 100 : 1);
  }

  async function seedEpisode(text: string): Promise<string> {
    const id = deterministicMemoryUuid(PERSONA, PERSONALITY, text);
    const vec = await embeddings.getEmbedding(text);
    const vecLiteral = `[${Array.from(vec ?? []).join(',')}]`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO memories (id, persona_id, personality_id, content, embedding, created_at, updated_at)
       VALUES ('${id}', '${PERSONA}', '${PERSONALITY}', $1, '${vecLiteral}'::vector, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      text
    );
    return id;
  }

  function makeJob(sourceMemoryIds: string[]): FactExtractionJobData {
    return {
      requestId: 'req-component-1',
      jobType: JobType.FactExtraction,
      responseDestination: { type: 'api' },
      version: 1,
      channelId: 'chan-component',
      personalityId: PERSONALITY,
      sourceMemoryIds,
      windowStart: sourceMemoryIds[0],
    };
  }

  it('extracts a fact end-to-end: real episode rows → real memory_facts row', async () => {
    const ep = await seedEpisode('{user}: my cat is named Miso\n{assistant}: Lovely name!');
    const invoker = vi.fn().mockResolvedValue(
      JSON.stringify({
        facts: [
          {
            statement: 'The user has a cat named Miso',
            entityTags: ['user', 'pet:miso'],
            salience: 0.7,
            supersedesIndex: null,
          },
        ],
      })
    );
    const service = new FactExtractionService(prisma, factStore, makeBudget(), invoker);

    const written = await service.processBatch(makeJob([ep]));

    expect(written).toBe(1);
    const rows = await prisma.memoryFact.findMany({ where: { personalityId: PERSONALITY } });
    expect(rows).toHaveLength(1);
    expect(rows[0].statement).toBe('The user has a cat named Miso');
    expect(rows[0].personaId).toBe(PERSONA);
    expect(rows[0].tier).toBe('observed');
    expect(rows[0].supersededAt).toBeNull();
    expect(rows[0].sourceMemoryIds).toEqual([ep]);
  });

  it('supersession end-to-end: an indexed target gets its columns flipped in the same write', async () => {
    // Seed an existing active fact via the store (real embed + insert).
    const oldEmbedding = await factStore.embedStatement('The user lives in Seattle');
    const oldId = await factStore.writeFactWithSupersessions(
      {
        personalityId: PERSONALITY,
        personaId: PERSONA,
        statement: 'The user lives in Seattle',
        entityTags: ['user'],
        salience: 0.6,
        isFiction: false,
        sourceMemoryIds: [],
        extractionJobId: 'seed',
      },
      [],
      oldEmbedding
    );

    const ep = await seedEpisode('{user}: I moved to Denver last week!\n{assistant}: Congrats!');
    const invoker = vi.fn().mockResolvedValue(
      JSON.stringify({
        facts: [
          {
            statement: 'The user lives in Denver',
            entityTags: ['user'],
            salience: 0.7,
            supersedesIndex: 0, // the injected known-facts list has exactly the Seattle fact
          },
        ],
      })
    );
    const service = new FactExtractionService(prisma, factStore, makeBudget(), invoker);

    await service.processBatch(makeJob([ep]));

    const oldFact = await prisma.memoryFact.findUnique({ where: { id: oldId } });
    expect(oldFact?.supersededAt).not.toBeNull();
    const newFact = await prisma.memoryFact.findFirst({
      where: { statement: 'The user lives in Denver' },
    });
    expect(newFact).not.toBeNull();
    expect(oldFact?.supersededById).toBe(newFact?.id);

    // The prompt really carried the numbered known fact (the seam the index depends on).
    const prompt = invoker.mock.calls[0][0] as string;
    expect(prompt).toContain('[0] The user lives in Seattle');
  });

  it('re-running the same batch is idempotent (content-hash ids, ON CONFLICT no-op)', async () => {
    const ep = await seedEpisode('{user}: I am a nurse\n{assistant}: A demanding job!');
    const invoker = vi.fn().mockResolvedValue(
      JSON.stringify({
        facts: [
          {
            statement: 'The user works as a nurse',
            entityTags: ['user'],
            salience: 0.7,
            supersedesIndex: null,
          },
        ],
      })
    );
    const service = new FactExtractionService(prisma, factStore, makeBudget(), invoker);

    await service.processBatch(makeJob([ep]));
    await service.processBatch(makeJob([ep]));

    const rows = await prisma.memoryFact.findMany({ where: { personalityId: PERSONALITY } });
    expect(rows).toHaveLength(1);
  });

  it('revives a superseded fact re-asserted verbatim (Seattle→Denver→Seattle)', async () => {
    // Seed Seattle (active), then supersede it with Denver.
    const seattleEmbedding = await factStore.embedStatement('The user lives in Seattle');
    const seattleId = await factStore.writeFactWithSupersessions(
      {
        personalityId: PERSONALITY,
        personaId: PERSONA,
        statement: 'The user lives in Seattle',
        entityTags: ['user'],
        salience: 0.6,
        isFiction: false,
        sourceMemoryIds: [],
        extractionJobId: 'seed-1',
      },
      [],
      seattleEmbedding
    );
    const denverEmbedding = await factStore.embedStatement('The user lives in Denver');
    const denverId = await factStore.writeFactWithSupersessions(
      {
        personalityId: PERSONALITY,
        personaId: PERSONA,
        statement: 'The user lives in Denver',
        entityTags: ['user'],
        salience: 0.6,
        isFiction: false,
        sourceMemoryIds: [],
        extractionJobId: 'seed-2',
      },
      [seattleId],
      denverEmbedding
    );

    // The user moves back: the extractor re-asserts Seattle VERBATIM and
    // names Denver (index 0 of the active-facts context) as superseded.
    const ep = await seedEpisode('{user}: moved back to Seattle!\n{assistant}: Welcome home!');
    const invoker = vi.fn().mockResolvedValue(
      JSON.stringify({
        facts: [
          {
            statement: 'The user lives in Seattle',
            entityTags: ['user'],
            salience: 0.7,
            supersedesIndex: 0,
          },
        ],
      })
    );
    const service = new FactExtractionService(prisma, factStore, makeBudget(), invoker);

    await service.processBatch(makeJob([ep]));

    // Seattle is ACTIVE again; Denver is superseded; exactly one active fact.
    const seattle = await prisma.memoryFact.findUnique({ where: { id: seattleId } });
    expect(seattle?.supersededAt).toBeNull();
    expect(seattle?.supersededById).toBeNull();
    const denver = await prisma.memoryFact.findUnique({ where: { id: denverId } });
    expect(denver?.supersededAt).not.toBeNull();
    const active = await prisma.memoryFact.findMany({
      where: { personalityId: PERSONALITY, supersededAt: null },
    });
    expect(active).toHaveLength(1);
    expect(active[0].statement).toBe('The user lives in Seattle');
  });

  it('does NOT revive a forgotten fact re-asserted verbatim (user removal is terminal)', async () => {
    const embedding = await factStore.embedStatement('The user lives in Seattle');
    const id = await factStore.writeFactWithSupersessions(
      {
        personalityId: PERSONALITY,
        personaId: PERSONA,
        statement: 'The user lives in Seattle',
        entityTags: ['user'],
        salience: 0.6,
        isFiction: false,
        sourceMemoryIds: [],
        extractionJobId: 'seed-1',
      },
      [],
      embedding
    );
    // User forgets it (terminal: forgotten + supersededAt, no successor).
    await prisma.memoryFact.update({
      where: { id },
      data: { forgotten: true, supersededAt: new Date() },
    });

    const ep = await seedEpisode('{user}: I live in Seattle btw\n{assistant}: Noted!');
    const invoker = vi.fn().mockResolvedValue(
      JSON.stringify({
        facts: [
          {
            statement: 'The user lives in Seattle',
            entityTags: ['user'],
            salience: 0.7,
            supersedesIndex: null,
          },
        ],
      })
    );
    const service = new FactExtractionService(prisma, factStore, makeBudget(), invoker);

    await service.processBatch(makeJob([ep]));

    const fact = await prisma.memoryFact.findUnique({ where: { id } });
    expect(fact?.forgotten).toBe(true);
    expect(fact?.supersededAt).not.toBeNull();
  });

  it('budget exhaustion skips extraction entirely (no model call, no rows)', async () => {
    const ep = await seedEpisode('{user}: I am from Tokyo\n{assistant}: Nice!');
    const invoker = vi.fn();
    const service = new FactExtractionService(prisma, factStore, makeBudget(false), invoker);

    const written = await service.processBatch(makeJob([ep]));

    expect(written).toBe(0);
    expect(invoker).not.toHaveBeenCalled();
    expect(await prisma.memoryFact.count()).toBe(0);
  });

  it('fail-to-skip: a non-JSON model response writes nothing', async () => {
    const ep = await seedEpisode('{user}: hello\n{assistant}: hi');
    const invoker = vi.fn().mockResolvedValue('I cannot help with that.');
    const service = new FactExtractionService(prisma, factStore, makeBudget(), invoker);

    const written = await service.processBatch(makeJob([ep]));

    expect(written).toBe(0);
    expect(await prisma.memoryFact.count()).toBe(0);
  });
});
