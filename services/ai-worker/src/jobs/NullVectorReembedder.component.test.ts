/**
 * Component test: the NULL-vector self-healing sweep over REAL PGLite+pgvector.
 * Proves the full acceptance: a seeded NULL-vector row is re-embedded AND
 * becomes RAG-visible again; soft-deleted rows are skipped; repeat runs no-op.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { LocalEmbeddingService } from '@tzurot/embeddings';
import { deterministicMemoryUuid } from '@tzurot/common-types/constants/memory';
import { PgvectorMemoryAdapter } from '../services/PgvectorMemoryAdapter.js';
import { NullVectorReembedder } from './NullVectorReembedder.js';

const USER = '4f9b0f66-0000-4000-8000-00000000e001';
const PERSONA = '4f9b0f66-0000-4000-8000-00000000e002';
const PERSONALITY = '4f9b0f66-0000-4000-8000-00000000e003';
const SYSTEM_PROMPT = '4f9b0f66-0000-4000-8000-00000000e004';

describe('NullVectorReembedder (component, PGLite)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;
  let embeddings: LocalEmbeddingService;
  let adapter: PgvectorMemoryAdapter;
  let sweeper: NullVectorReembedder;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;

    await seedUserWithPersona(prisma, {
      userId: USER,
      personaId: PERSONA,
      discordId: '900000000000000077',
      username: 'sweepuser',
      personaName: 'Sweep Persona',
      personaPreferredName: 'Sweepy',
      personaContent: 'The self-healing persona',
    });
    await prisma.$executeRaw`
      INSERT INTO system_prompts (id, name, content, updated_at)
      VALUES (${SYSTEM_PROMPT}::uuid, 'Sweep Prompt', 'You are a sweep bot.', NOW())
    `;
    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, display_name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES (${PERSONALITY}::uuid, 'SweepBot', 'Sweep Bot', 'sweepbot', ${SYSTEM_PROMPT}::uuid, 'Sweep character', 'Diligent', ${USER}::uuid, NOW())
    `;

    embeddings = new LocalEmbeddingService();
    const ready = await embeddings.initialize();
    if (!ready) {
      throw new Error('Local embedding model failed to initialize');
    }
    adapter = new PgvectorMemoryAdapter(prisma, embeddings);
    sweeper = new NullVectorReembedder(prisma, adapter);
  }, 180_000);

  afterAll(async () => {
    await embeddings.shutdown();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM memories`;
  });

  async function seedNullVectorMemory(text: string, visibility = 'normal'): Promise<string> {
    const id = deterministicMemoryUuid(PERSONA, PERSONALITY, text);
    await prisma.$executeRaw`
      INSERT INTO memories (id, persona_id, personality_id, content, embedding, visibility, created_at, updated_at)
      VALUES (${id}::uuid, ${PERSONA}::uuid, ${PERSONALITY}::uuid, ${text}, NULL, ${visibility}, NOW(), NOW())
    `;
    return id;
  }

  it('re-embeds a NULL-vector row and restores RAG visibility; skips soft-deleted; idempotent', async () => {
    const orphanId = await seedNullVectorMemory(
      'The user has a pet dragon named Ember that breathes purple fire'
    );
    const deletedId = await seedNullVectorMemory('A soft-deleted memory about sailing', 'deleted');

    const stats = await sweeper.sweep();
    expect(stats.scanned).toBe(1); // the soft-deleted row was never a candidate
    expect(stats.reembedded).toBe(1);
    expect(stats.failed).toBe(0);

    // The healed row has a real vector; the soft-deleted row stays NULL.
    const vectors = await prisma.$queryRaw<{ id: string; has_embedding: boolean }[]>`
      SELECT id, (embedding IS NOT NULL) AS has_embedding FROM memories ORDER BY created_at
    `;
    expect(vectors.find(v => v.id === orphanId)?.has_embedding).toBe(true);
    expect(vectors.find(v => v.id === deletedId)?.has_embedding).toBe(false);

    // RAG-visible again: similarity search finds the healed memory.
    const results = await adapter.queryMemories('pet dragon purple fire', {
      personaId: PERSONA,
      personalityId: PERSONALITY,
      limit: 5,
      scoreThreshold: 0.01,
    });
    expect(results.some(r => r.pageContent.includes('dragon named Ember'))).toBe(true);

    // Idempotent: a second sweep finds nothing to do.
    const second = await sweeper.sweep();
    expect(second).toEqual({ scanned: 0, reembedded: 0, failed: 0 });
  });
});
