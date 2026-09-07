/**
 * Component Test: memory-archive summarizer processor (real SQL, PGLite)
 *
 * The whole write-path design rests on SQL semantics a mocked `$executeRaw`
 * cannot model: whether the raw UPDATE leaves `updated_at` untouched, and
 * whether the attempts CASE actually accumulates/resets against Postgres
 * rather than the test's own assumption about what it does. Also covers
 * `ArchiveSummaryTrigger`'s stamp SQL against the same real-SQL concern: the
 * CASE that decides which statuses are terminal.
 */

import type { PGlite } from '@electric-sql/pglite';
import type { Queue } from 'bullmq';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { JobType } from '@tzurot/common-types/constants/queue';
import type { ArchiveSummaryJobData } from '@tzurot/common-types/types/jobs';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArchiveSummaryProcessor } from './ArchiveSummaryProcessor.js';
import { ArchiveSummaryTrigger } from './ArchiveSummaryTrigger.js';
import type { SystemModelInvoker, SystemModelResult } from '../systemModel/systemModelCall.js';
import type { ArchiveSummaryBudget } from './ArchiveSummaryBudget.js';

vi.mock('../systemModel/systemModelCall.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../systemModel/systemModelCall.js')>();
  return {
    ...actual,
    resolveSystemModelRoute: () => ({ provider: AIProvider.ZaiCoding }),
  };
});

const OWNER_ID = '4f9b0f66-5555-4000-8000-0000000000a0';
const PERSONA_ID = '4f9b0f66-5555-4000-8000-0000000000a1';
const PERSONALITY_ID = '4f9b0f66-5555-4000-8000-0000000000a2';

let pglite: PGlite;
let prisma: PrismaClient;

function memoryId(n: number): string {
  return `4f9b0f66-5555-4000-8000-0000000000${n.toString(16).padStart(2, '0')}`;
}

async function seedPersonality(): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO personalities (id, name, slug, character_info, personality_traits, owner_id, updated_at)
    VALUES (${PERSONALITY_ID}::uuid, 'Nova', 'nova', 'A friendly guide.', 'warm, curious', ${OWNER_ID}::uuid, NOW())
  `;
}

async function seedMemory(n: number, content: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO memories (id, persona_id, personality_id, content, message_ids, senders, created_at, updated_at)
    VALUES (${memoryId(n)}::uuid, ${PERSONA_ID}::uuid, ${PERSONALITY_ID}::uuid, ${content}, ARRAY[]::text[], ARRAY[]::text[], NOW(), NOW())
  `;
}

interface MemoryRow {
  assistant_summary: string | null;
  summary_status: string | null;
  summary_model: string | null;
  summary_prompt_version: number | null;
  source_content_hash: string | null;
  summary_completed_at: Date | null;
  summary_attempts: number;
  summary_last_error: string | null;
  summary_requested_at: Date | null;
  updated_at: Date;
}

async function readMemory(n: number): Promise<MemoryRow> {
  const rows = await prisma.$queryRaw<MemoryRow[]>`
    SELECT assistant_summary, summary_status, summary_model, summary_prompt_version,
           source_content_hash, summary_completed_at, summary_attempts, summary_last_error,
           summary_requested_at, updated_at
    FROM memories WHERE id = ${memoryId(n)}::uuid
  `;
  return rows[0];
}

function makeJobData(n: number): ArchiveSummaryJobData {
  return {
    requestId: `req-${n}`,
    jobType: JobType.ArchiveSummary,
    responseDestination: { type: 'api' },
    version: 1,
    memoryId: memoryId(n),
    personalityId: PERSONALITY_ID,
    reason: 'write',
  };
}

function makeJobHandle(): { id: string; moveToDelayed: () => Promise<void> } {
  return { id: 'job', moveToDelayed: async () => undefined };
}

function successInvoker(): SystemModelInvoker {
  return vi.fn<SystemModelInvoker>().mockResolvedValue({
    content: '{"summary": "Jules greeted Nova and Nova greeted them back warmly."}',
    tokensIn: 10,
    tokensOut: 10,
    provider: AIProvider.ZaiCoding,
    model: 'z-ai/glm-5.2',
  } satisfies SystemModelResult);
}

function failingInvoker(): SystemModelInvoker {
  return vi.fn<SystemModelInvoker>().mockResolvedValue({
    content: 'not json',
    tokensIn: 10,
    tokensOut: 5,
    provider: AIProvider.ZaiCoding,
    model: 'z-ai/glm-5.2',
  } satisfies SystemModelResult);
}

function makeBudget(): ArchiveSummaryBudget {
  return {
    tryConsume: vi
      .fn()
      .mockResolvedValue({ allowed: true, refund: vi.fn().mockResolvedValue(undefined) }),
  } as unknown as ArchiveSummaryBudget;
}

beforeAll(async () => {
  pglite = await createTestPGlite();
  await pglite.exec(loadPGliteSchema());
  prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) });
  await seedUserWithPersona(prisma, {
    userId: OWNER_ID,
    personaId: PERSONA_ID,
    discordId: '100000000000000002',
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  await pglite.close();
  resetSystemSettingsRegistration();
});

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM usage_logs`;
  await prisma.$executeRaw`DELETE FROM memories`;
  await prisma.$executeRaw`DELETE FROM personalities`;
  await seedPersonality();
  registerSystemSettings({
    get: (key: string) =>
      key === 'archiveSummaryModelEnabled'
        ? true
        : key === 'archiveSummaryDailyCap'
          ? 2000
          : undefined,
  } as unknown as SystemSettingsService);
});

describe('ArchiveSummaryProcessor (PGLite)', () => {
  it('MEM-ARCH-016: the summary write leaves updated_at untouched', async () => {
    await seedMemory(1, '{user}: hi there\n{assistant}: hello!');
    const before = await readMemory(1);

    const processor = new ArchiveSummaryProcessor({
      prisma,
      budget: makeBudget(),
      invokeModel: successInvoker(),
    });
    const result = await processor.process(makeJobHandle(), undefined, makeJobData(1));
    expect(result).toEqual({ outcome: 'done' });

    const after = await readMemory(1);
    expect(after.assistant_summary).not.toBeNull();
    expect(after.summary_status).toBe('done');
    expect(after.summary_model).toBe('z-ai/glm-5.2');
    expect(after.summary_prompt_version).toBe(1);
    expect(after.source_content_hash).not.toBeNull();
    expect(after.summary_completed_at).not.toBeNull();
    expect(after.summary_attempts).toBe(0);
    expect(after.summary_last_error).toBeNull();
    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());
  });

  it('MEM-ARCH-020: three consecutive billed failures against the same content mark the row dead', async () => {
    await seedMemory(2, '{user}: hi there\n{assistant}: hello!');
    const budget = makeBudget();

    const processor1 = new ArchiveSummaryProcessor({
      prisma,
      budget,
      invokeModel: failingInvoker(),
    });
    await processor1.process(makeJobHandle(), undefined, makeJobData(2));
    let row = await readMemory(2);
    expect(row.summary_attempts).toBe(1);
    expect(row.summary_status).toBe('failed');

    const processor2 = new ArchiveSummaryProcessor({
      prisma,
      budget,
      invokeModel: failingInvoker(),
    });
    await processor2.process(makeJobHandle(), undefined, makeJobData(2));
    row = await readMemory(2);
    expect(row.summary_attempts).toBe(2);
    expect(row.summary_status).toBe('failed');

    const processor3 = new ArchiveSummaryProcessor({
      prisma,
      budget,
      invokeModel: failingInvoker(),
    });
    await processor3.process(makeJobHandle(), undefined, makeJobData(2));
    row = await readMemory(2);
    expect(row.summary_attempts).toBe(3);
    expect(row.summary_status).toBe('dead');
  });

  it('the attempts CASE resets to 1 when the content hash changes between attempts', async () => {
    await seedMemory(3, '{user}: hi there\n{assistant}: hello!');
    const budget = makeBudget();

    await new ArchiveSummaryProcessor({ prisma, budget, invokeModel: failingInvoker() }).process(
      makeJobHandle(),
      undefined,
      makeJobData(3)
    );
    let row = await readMemory(3);
    expect(row.summary_attempts).toBe(1);

    // A genuine content edit changes the row's content — the next billed
    // failure computes against a DIFFERENT source_content_hash, so the CASE
    // must restart the count at 1 rather than continuing from the old row.
    await prisma.$executeRaw`UPDATE memories SET content = ${'{user}: a different message\n{assistant}: a different reply'} WHERE id = ${memoryId(3)}::uuid`;

    await new ArchiveSummaryProcessor({ prisma, budget, invokeModel: failingInvoker() }).process(
      makeJobHandle(),
      undefined,
      makeJobData(3)
    );
    row = await readMemory(3);
    expect(row.summary_attempts).toBe(1);
  });

  it('MEM-ARCH-015: a row whose content has no template is marked dead/no_template, the invoker is never called, and the budget is never consumed', async () => {
    await seedMemory(4, 'this content does not match the template at all');
    const invokeModel = failingInvoker();
    const budget = makeBudget();

    const processor = new ArchiveSummaryProcessor({ prisma, budget, invokeModel });
    const result = await processor.process(makeJobHandle(), undefined, makeJobData(4));

    expect(result).toEqual({ outcome: 'dead' });
    expect(invokeModel).not.toHaveBeenCalled();
    expect(budget.tryConsume).not.toHaveBeenCalled();
    const row = await readMemory(4);
    expect(row.summary_status).toBe('dead');
    expect(row.summary_last_error).toBe('no_template');
  });

  it('MEM-ARCH-016: a content edit landing between load and write leaves the row untouched (superseded)', async () => {
    await seedMemory(5, '{user}: hi there\n{assistant}: hello!');

    const invokeModel = vi.fn<SystemModelInvoker>().mockImplementation(async () => {
      await prisma.$executeRaw`
        UPDATE memories
        SET content = ${'{user}: edited\n{assistant}: edited reply'},
            assistant_summary = NULL, summary_status = NULL, source_content_hash = NULL,
            summary_completed_at = NULL, summary_attempts = 0, summary_last_error = NULL
        WHERE id = ${memoryId(5)}::uuid
      `;
      return {
        content: '{"summary": "Jules greeted Nova and Nova greeted them back warmly."}',
        tokensIn: 10,
        tokensOut: 10,
        provider: AIProvider.ZaiCoding,
        model: 'z-ai/glm-5.2',
      } satisfies SystemModelResult;
    });

    const processor = new ArchiveSummaryProcessor({
      prisma,
      budget: makeBudget(),
      invokeModel,
    });
    const result = await processor.process(makeJobHandle(), undefined, makeJobData(5));

    expect(result).toEqual({ outcome: 'superseded' });
    const row = await readMemory(5);
    expect(row.assistant_summary).toBeNull();
    expect(row.summary_status).toBeNull();
    expect(row.source_content_hash).toBeNull();
    expect(row.summary_completed_at).toBeNull();
    expect(row.summary_last_error).toBeNull();
    expect(row.summary_attempts).toBe(0);
  });

  it('MEM-ARCH-023: the usage row is attributed to the persona owner carried on the loaded row', async () => {
    await seedMemory(6, '{user}: hi there\n{assistant}: hello!');

    const processor = new ArchiveSummaryProcessor({
      prisma,
      budget: makeBudget(),
      invokeModel: successInvoker(),
    });
    await processor.process(makeJobHandle(), undefined, makeJobData(6));

    const rows = await prisma.$queryRaw<{ user_id: string; request_type: string }[]>`
      SELECT user_id, request_type FROM usage_logs
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(OWNER_ID);
    expect(rows[0].request_type).toBe('archive_summary');
  });

  it('MEM-ARCH-020: a dead row from billed failures skips re-enqueue without a model call or budget consumption', async () => {
    await seedMemory(9, '{user}: hi there\n{assistant}: hello!');
    const budget = makeBudget();

    for (let i = 0; i < 3; i++) {
      const processor = new ArchiveSummaryProcessor({
        prisma,
        budget,
        invokeModel: failingInvoker(),
      });
      await processor.process(makeJobHandle(), undefined, makeJobData(9));
    }
    const dead = await readMemory(9);
    expect(dead.summary_status).toBe('dead');
    expect(dead.summary_prompt_version).toBe(1);

    const invokeModel = failingInvoker();
    const freshBudget = makeBudget();
    const processor = new ArchiveSummaryProcessor({ prisma, budget: freshBudget, invokeModel });
    const result = await processor.process(makeJobHandle(), undefined, makeJobData(9));

    expect(result).toEqual({ outcome: 'skipped' });
    expect(invokeModel).not.toHaveBeenCalled();
    expect(freshBudget.tryConsume).not.toHaveBeenCalled();
  });

  it('MEM-ARCH-015: a dead row from no-template skips re-enqueue without a model call or budget consumption', async () => {
    await seedMemory(10, 'this content does not match the template at all');

    const first = new ArchiveSummaryProcessor({
      prisma,
      budget: makeBudget(),
      invokeModel: failingInvoker(),
    });
    const firstResult = await first.process(makeJobHandle(), undefined, makeJobData(10));
    expect(firstResult).toEqual({ outcome: 'dead' });
    const dead = await readMemory(10);
    expect(dead.summary_prompt_version).toBe(1);

    const invokeModel = failingInvoker();
    const freshBudget = makeBudget();
    const processor = new ArchiveSummaryProcessor({ prisma, budget: freshBudget, invokeModel });
    const result = await processor.process(makeJobHandle(), undefined, makeJobData(10));

    expect(result).toEqual({ outcome: 'skipped' });
    expect(invokeModel).not.toHaveBeenCalled();
    expect(freshBudget.tryConsume).not.toHaveBeenCalled();
  });

  it('a dead row with a stale prompt version is reprocessed, not skipped', async () => {
    await seedMemory(11, '{user}: hi there\n{assistant}: hello!');
    const budget = makeBudget();

    for (let i = 0; i < 3; i++) {
      const processor = new ArchiveSummaryProcessor({
        prisma,
        budget,
        invokeModel: failingInvoker(),
      });
      await processor.process(makeJobHandle(), undefined, makeJobData(11));
    }
    expect((await readMemory(11)).summary_status).toBe('dead');

    await prisma.$executeRaw`UPDATE memories SET summary_prompt_version = 0 WHERE id = ${memoryId(11)}::uuid`;

    const invokeModel = successInvoker();
    const processor = new ArchiveSummaryProcessor({ prisma, budget: makeBudget(), invokeModel });
    const result = await processor.process(makeJobHandle(), undefined, makeJobData(11));

    expect(invokeModel).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ outcome: 'done' });
  });

  it('MEM-ARCH-020: a prompt-version bump restarts the attempts budget instead of re-killing the row', async () => {
    await seedMemory(12, '{user}: hi there\n{assistant}: hello!');
    const budget = makeBudget();

    for (let i = 0; i < 3; i++) {
      const processor = new ArchiveSummaryProcessor({
        prisma,
        budget,
        invokeModel: failingInvoker(),
      });
      await processor.process(makeJobHandle(), undefined, makeJobData(12));
    }
    expect((await readMemory(12)).summary_status).toBe('dead');

    // A prompt-version bump re-admits the row (the processor's idempotence
    // check requires a CURRENT version, so a dead row with a stale one is not
    // skipped), but the attempts CASE keyed on content hash alone
    // would still see the same hash and continue the count from 3 — killing
    // the row again on the very next billed failure instead of granting a
    // fresh budget the same way a content edit does.
    await prisma.$executeRaw`UPDATE memories SET summary_prompt_version = 0 WHERE id = ${memoryId(12)}::uuid`;

    const processor = new ArchiveSummaryProcessor({
      prisma,
      budget: makeBudget(),
      invokeModel: failingInvoker(),
    });
    await processor.process(makeJobHandle(), undefined, makeJobData(12));

    const row = await readMemory(12);
    expect(row.summary_attempts).toBe(1);
    expect(row.summary_status).toBe('failed');
  });
});

describe('ArchiveSummaryTrigger write-side stamp', () => {
  function makeMockQueue(): Queue {
    return { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue;
  }

  it('a dead row stays dead — the stamp never re-admits a dead row to pending', async () => {
    await seedMemory(7, '{user}: hi there\n{assistant}: hello!');
    await prisma.$executeRaw`
      UPDATE memories SET summary_status = 'dead' WHERE id = ${memoryId(7)}::uuid
    `;

    const trigger = new ArchiveSummaryTrigger(prisma, makeMockQueue(), () => true);
    await trigger.enqueue({
      memoryId: memoryId(7),
      personalityId: PERSONALITY_ID,
      reason: 'sweep',
    });

    const row = await readMemory(7);
    expect(row.summary_status).toBe('dead');
    expect(row.summary_requested_at).not.toBeNull();
  });

  it('a failed row DOES flip to pending — the CASE did not over-broaden into a blanket no-op', async () => {
    await seedMemory(8, '{user}: hi there\n{assistant}: hello!');
    await prisma.$executeRaw`
      UPDATE memories SET summary_status = 'failed' WHERE id = ${memoryId(8)}::uuid
    `;

    const trigger = new ArchiveSummaryTrigger(prisma, makeMockQueue(), () => true);
    await trigger.enqueue({
      memoryId: memoryId(8),
      personalityId: PERSONALITY_ID,
      reason: 'sweep',
    });

    const row = await readMemory(8);
    expect(row.summary_status).toBe('pending');
    expect(row.summary_requested_at).not.toBeNull();
  });
});
