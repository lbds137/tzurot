/**
 * Component Test: memory-deletion propagation, fact layer (R8)
 *
 * The cascade is a raw-SQL join (array overlap against deleted memories), so
 * mocked-Prisma unit tests can only assert it was invoked — whether the
 * predicate retires exactly the right rows (any-source semantics, curation
 * carve-outs, state exclusions, self-healing over historical deletions) is
 * only testable against real Postgres semantics. PGlite is that boundary.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  propagateDeletionToFacts,
  propagateDeletionToMemories,
} from './memoryDeletionPropagation.js';

describe('propagateDeletionToFacts (component)', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;

  const testUserId = '00000000-0000-0000-0000-000000000001';
  const testPersonaId = '00000000-0000-0000-0000-000000000002';
  const testPersonalityId = '00000000-0000-0000-0000-000000000003';

  const MEM_ALIVE = '10000000-0000-0000-0000-000000000001';
  const MEM_DELETED = '10000000-0000-0000-0000-000000000002';

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    const adapter = new PrismaPGlite(pglite);
    prisma = new PrismaClient({ adapter }) as PrismaClient;

    await seedUserWithPersona(prisma, {
      userId: testUserId,
      personaId: testPersonaId,
      discordId: '111111111111111111',
      username: 'testuser',
      personaName: 'Test Persona',
      personaPreferredName: 'Tester',
      personaContent: 'A test persona',
    });

    const systemPromptId = '00000000-0000-0000-0000-000000000004';
    await prisma.$executeRawUnsafe(`
      INSERT INTO system_prompts (id, name, content, updated_at)
      VALUES ('${systemPromptId}', 'Test Prompt', 'You are a test bot.', NOW())
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO personalities (id, name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES ('${testPersonalityId}', 'TestBot', 'testbot', '${systemPromptId}', 'Test bot', 'Helpful', '${testUserId}', NOW())
    `);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM memory_facts');
    await prisma.$executeRawUnsafe('DELETE FROM memories');
    await seedMemory(MEM_ALIVE, 'normal');
    await seedMemory(MEM_DELETED, 'deleted');
  });

  async function seedMemory(
    id: string,
    visibility: string,
    opts: { messageIds?: string[] } = {}
  ): Promise<void> {
    await prisma.$executeRaw`
      INSERT INTO memories
        (id, personality_id, persona_id, content, message_ids, senders, visibility, updated_at)
      VALUES
        (${id}::uuid, ${testPersonalityId}::uuid, ${testPersonaId}::uuid, 'memory content',
         ${opts.messageIds ?? []}::text[], '{}'::text[], ${visibility}, NOW())
    `;
  }

  async function seedFact(
    id: string,
    sourceMemoryIds: string[],
    opts: {
      visibility?: string;
      isLocked?: boolean;
      tier?: string;
      forgotten?: boolean;
      supersededAt?: string | null;
    } = {}
  ): Promise<void> {
    await prisma.$executeRaw`
      INSERT INTO memory_facts
        (id, personality_id, persona_id, statement, salience, valid_from,
         superseded_at, forgotten, visibility, is_locked, tier, source_memory_ids,
         created_at, updated_at)
      VALUES
        (${id}::uuid, ${testPersonalityId}::uuid, ${testPersonaId}::uuid, 'a fact', 0.5,
         '2026-01-01T00:00:00Z'::timestamptz, ${opts.supersededAt ?? null}::timestamptz,
         ${opts.forgotten ?? false}, ${opts.visibility ?? 'normal'}, ${opts.isLocked ?? false},
         ${opts.tier ?? 'observed'}, ${sourceMemoryIds}::text[],
         '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `;
  }

  async function factState(
    id: string
  ): Promise<{ visibility: string; forgotten: boolean; updatedAt: Date } | null> {
    const row = await prisma.memoryFact.findUnique({
      where: { id },
      select: { visibility: true, forgotten: true, updatedAt: true },
    });
    return row;
  }

  const FACT = '20000000-0000-0000-0000-000000000001';

  it('retires a fact when ANY source memory is deleted — even with living co-sources', async () => {
    await seedFact(FACT, [MEM_DELETED, MEM_ALIVE]);

    await propagateDeletionToFacts(prisma);

    const fact = await factState(FACT);
    expect(fact?.visibility).toBe('deleted');
    // Semantic state change → updated_at must bump (dev↔prod LWW sync-worthy).
    expect(fact?.updatedAt.getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime());
  });

  it('leaves a fact alone when every source memory is still living', async () => {
    await seedFact(FACT, [MEM_ALIVE]);

    await propagateDeletionToFacts(prisma);

    expect((await factState(FACT))?.visibility).toBe('normal');
  });

  it('retains a LOCKED fact — a user pin outranks source deletion', async () => {
    await seedFact(FACT, [MEM_DELETED], { isLocked: true });

    await propagateDeletionToFacts(prisma);

    expect((await factState(FACT))?.visibility).toBe('normal');
  });

  it('retains a CORRECTED-tier fact — a user assertion outranks source deletion', async () => {
    await seedFact(FACT, [MEM_DELETED], { tier: 'corrected' });

    await propagateDeletionToFacts(prisma);

    expect((await factState(FACT))?.visibility).toBe('normal');
  });

  it('does not touch forgotten or superseded rows — their states are their own', async () => {
    const FORGOTTEN = '20000000-0000-0000-0000-000000000002';
    const SUPERSEDED = '20000000-0000-0000-0000-000000000003';
    await seedFact(FORGOTTEN, [MEM_DELETED], { forgotten: true });
    await seedFact(SUPERSEDED, [MEM_DELETED], { supersededAt: '2026-02-01T00:00:00Z' });

    await propagateDeletionToFacts(prisma);

    // Both already excluded from retrieval; flipping their visibility would
    // inflate the cascade count and muddy revival semantics.
    expect((await factState(FORGOTTEN))?.visibility).toBe('normal');
    expect((await factState(SUPERSEDED))?.visibility).toBe('normal');
  });

  it('does not resurrect or re-touch an already-cascaded fact', async () => {
    await seedFact(FACT, [MEM_DELETED], { visibility: 'deleted' });

    await propagateDeletionToFacts(prisma);

    const fact = await factState(FACT);
    expect(fact?.visibility).toBe('deleted');
    // No second write: updated_at keeps its original stamp.
    expect(fact?.updatedAt.getTime()).toBe(new Date('2026-01-01T00:00:00Z').getTime());
  });

  it('propagates a message deletion through the full chain: message → memory → fact', async () => {
    // The wiring test: real chain over the real DB, mocking nothing. A message
    // deletion soft-deletes the derived memory, which retires the derived fact.
    const MEM_FROM_MSG = '10000000-0000-0000-0000-000000000003';
    await seedMemory(MEM_FROM_MSG, 'normal', { messageIds: ['999888777666555444'] });
    await seedFact(FACT, [MEM_FROM_MSG]);

    await propagateDeletionToMemories(prisma, ['999888777666555444']);

    const memory = await prisma.memory.findUnique({
      where: { id: MEM_FROM_MSG },
      select: { visibility: true },
    });
    expect(memory?.visibility).toBe('deleted');
    expect((await factState(FACT))?.visibility).toBe('deleted');
  });

  it('self-heals: retires facts leaked by deletions that predate the cascade', async () => {
    // MEM_DELETED was deleted "before the cascade existed" (no propagation ran
    // for it). Any later invocation — triggered by an unrelated deletion —
    // sweeps the leak, because the predicate joins ALL deleted memories.
    await seedFact(FACT, [MEM_DELETED]);
    const UNRELATED = '10000000-0000-0000-0000-000000000004';
    await seedMemory(UNRELATED, 'normal', { messageIds: ['111222333444555666'] });

    await propagateDeletionToMemories(prisma, ['111222333444555666']);

    expect((await factState(FACT))?.visibility).toBe('deleted');
  });
});
