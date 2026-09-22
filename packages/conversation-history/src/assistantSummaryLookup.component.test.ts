/**
 * Component Test: retrieval-time assistant-summary lookup
 *
 * The usability predicate combines several columns (`summary_status`,
 * `assistant_summary`, `chunk_group_id`, `visibility`, `personality_id`) — a
 * mocked-Prisma unit test can only assert the where-clause shape sent to
 * Prisma, not that Postgres actually applies it the way the predicate intends.
 * PGlite is that boundary.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { findUsableAssistantSummariesByTriggerIds } from './assistantSummaryLookup.js';

describe('findUsableAssistantSummariesByTriggerIds (component)', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;

  const testUserId = '00000000-0000-0000-0000-000000000001';
  const testPersonaId = '00000000-0000-0000-0000-000000000002';
  const testPersonalityId = '00000000-0000-0000-0000-000000000003';
  const otherPersonalityId = '00000000-0000-0000-0000-000000000005';

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
    await prisma.$executeRawUnsafe(`
      INSERT INTO personalities (id, name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES ('${otherPersonalityId}', 'OtherBot', 'otherbot', '${systemPromptId}', 'Other bot', 'Helpful', '${testUserId}', NOW())
    `);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM memories');
  });

  async function seedMemory(
    id: string,
    messageIds: string[],
    opts: {
      personalityId?: string;
      visibility?: string;
      summaryStatus?: string | null;
      assistantSummary?: string | null;
      chunkGroupId?: string | null;
      createdAt?: string;
    } = {}
  ): Promise<void> {
    await prisma.$executeRaw`
      INSERT INTO memories
        (id, personality_id, persona_id, content, message_ids, senders, visibility,
         summary_status, assistant_summary, chunk_group_id, created_at, updated_at)
      VALUES
        (${id}::uuid, ${opts.personalityId ?? testPersonalityId}::uuid, ${testPersonaId}::uuid,
         'memory content', ${messageIds}::text[], '{}'::text[],
         ${opts.visibility ?? 'normal'}, ${opts.summaryStatus ?? null},
         ${opts.assistantSummary ?? null}, ${opts.chunkGroupId ?? null}::uuid,
         ${opts.createdAt ?? '2026-01-01T00:00:00Z'}::timestamptz, NOW())
    `;
  }

  it('returns a done + non-empty-summary + null-chunk-group + normal row for its trigger id', async () => {
    await seedMemory('10000000-0000-0000-0000-000000000001', ['msg-1'], {
      summaryStatus: 'done',
      assistantSummary: 'the stored summary',
    });

    const result = await findUsableAssistantSummariesByTriggerIds(
      prisma,
      testPersonalityId,
      ['msg-1'],
      10
    );

    expect(result.get('msg-1')).toBe('the stored summary');
  });

  it('does NOT return a row with summaryStatus failed even with a non-empty summary (C4 canary)', async () => {
    await seedMemory('10000000-0000-0000-0000-000000000002', ['msg-2'], {
      summaryStatus: 'failed',
      assistantSummary: 'leftover text',
    });

    const result = await findUsableAssistantSummariesByTriggerIds(
      prisma,
      testPersonalityId,
      ['msg-2'],
      10
    );

    expect(result.has('msg-2')).toBe(false);
  });

  it('does NOT return a row with visibility deleted (C9 canary target)', async () => {
    await seedMemory('10000000-0000-0000-0000-000000000003', ['msg-3'], {
      summaryStatus: 'done',
      assistantSummary: 'deleted memory summary',
      visibility: 'deleted',
    });

    const result = await findUsableAssistantSummariesByTriggerIds(
      prisma,
      testPersonalityId,
      ['msg-3'],
      10
    );

    expect(result.has('msg-3')).toBe(false);
  });

  it('does NOT return a row with a non-null chunkGroupId', async () => {
    const chunkGroupId = '30000000-0000-0000-0000-000000000001';
    await seedMemory('10000000-0000-0000-0000-000000000004', ['msg-4'], {
      summaryStatus: 'done',
      assistantSummary: 'chunked summary',
      chunkGroupId,
    });

    const result = await findUsableAssistantSummariesByTriggerIds(
      prisma,
      testPersonalityId,
      ['msg-4'],
      10
    );

    expect(result.has('msg-4')).toBe(false);
  });

  it('does NOT return a row belonging to a different personalityId', async () => {
    await seedMemory('10000000-0000-0000-0000-000000000005', ['msg-5'], {
      personalityId: otherPersonalityId,
      summaryStatus: 'done',
      assistantSummary: 'other personality summary',
    });

    const result = await findUsableAssistantSummariesByTriggerIds(
      prisma,
      testPersonalityId,
      ['msg-5'],
      10
    );

    expect(result.has('msg-5')).toBe(false);
  });

  it('returns the newest usable row for a trigger id even when take truncates the match set (round-1 finding 1)', async () => {
    await seedMemory('10000000-0000-0000-0000-000000000006', ['msg-6'], {
      summaryStatus: 'done',
      assistantSummary: 'the older summary',
      createdAt: '2026-01-01T00:00:00Z',
    });
    await seedMemory('10000000-0000-0000-0000-000000000007', ['msg-6'], {
      summaryStatus: 'done',
      assistantSummary: 'the newest summary',
      createdAt: '2026-06-01T00:00:00Z',
    });

    const result = await findUsableAssistantSummariesByTriggerIds(
      prisma,
      testPersonalityId,
      ['msg-6'],
      1
    );

    expect(result.get('msg-6')).toBe('the newest summary');
  });
});
