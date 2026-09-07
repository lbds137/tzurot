import { describe, it, expect, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { JobType } from '@tzurot/common-types/constants/queue';
import { ArchiveSummaryTrigger } from './ArchiveSummaryTrigger.js';

const MEMORY_ID = '4f9b0f66-2222-4000-8000-00000000000a';
const PERSONALITY_ID = '4f9b0f66-2222-4000-8000-00000000000b';

function makeQueue(addImpl?: () => Promise<unknown>): Queue {
  return { add: vi.fn(addImpl ?? (() => Promise.resolve())) } as unknown as Queue;
}

function makePrisma(executeRawImpl?: () => Promise<unknown>): PrismaClient {
  return {
    $executeRaw: vi.fn(executeRawImpl ?? (() => Promise.resolve(1))),
  } as unknown as PrismaClient;
}

describe('ArchiveSummaryTrigger', () => {
  it('enqueues a job with the memory id as the deterministic jobId', async () => {
    const queue = makeQueue();
    const prisma = makePrisma();
    const trigger = new ArchiveSummaryTrigger(prisma, queue, () => true);

    await trigger.enqueue({ memoryId: MEMORY_ID, personalityId: PERSONALITY_ID, reason: 'write' });

    expect(queue.add).toHaveBeenCalledWith(
      JobType.ArchiveSummary,
      {
        requestId: `archive-summary-${MEMORY_ID}`,
        jobType: JobType.ArchiveSummary,
        responseDestination: { type: 'api' },
        version: 1,
        memoryId: MEMORY_ID,
        personalityId: PERSONALITY_ID,
        reason: 'write',
      },
      { jobId: MEMORY_ID }
    );
  });

  it('skips entirely when disabled — no enqueue, no SQL', async () => {
    const queue = makeQueue();
    const prisma = makePrisma();
    const trigger = new ArchiveSummaryTrigger(prisma, queue, () => false);

    await trigger.enqueue({ memoryId: MEMORY_ID, personalityId: PERSONALITY_ID, reason: 'write' });

    expect(queue.add).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('stamps the row pending after a successful add', async () => {
    const queue = makeQueue();
    const prisma = makePrisma();
    const trigger = new ArchiveSummaryTrigger(prisma, queue, () => true);

    await trigger.enqueue({ memoryId: MEMORY_ID, personalityId: PERSONALITY_ID, reason: 'write' });

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('the stamp SQL preserves both terminal states (done and dead) and never blanket-resets to pending', async () => {
    const queue = makeQueue();
    const prisma = makePrisma();
    const trigger = new ArchiveSummaryTrigger(prisma, queue, () => true);

    await trigger.enqueue({ memoryId: MEMORY_ID, personalityId: PERSONALITY_ID, reason: 'write' });

    // $executeRaw is invoked as a tagged template — the mock's first arg is
    // the template-strings array. Join it to inspect the actual SQL text
    // rather than asserting on a stringified whole-call blob, so a revert of
    // the CASE back to `= 'done'` only fails this assertion.
    const templateStrings = vi.mocked(prisma.$executeRaw).mock
      .calls[0][0] as unknown as TemplateStringsArray;
    const sql = templateStrings.join('');
    expect(sql).toContain("IN ('done', 'dead')");
    expect(sql).toContain('summary_requested_at = NOW()');
  });

  it('swallows a rejecting queue.add and does not stamp the row', async () => {
    const queue = makeQueue(() => Promise.reject(new Error('queue down')));
    const prisma = makePrisma();
    const trigger = new ArchiveSummaryTrigger(prisma, queue, () => true);

    await expect(
      trigger.enqueue({ memoryId: MEMORY_ID, personalityId: PERSONALITY_ID, reason: 'write' })
    ).resolves.toBeUndefined();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('swallows a rejecting $executeRaw', async () => {
    const queue = makeQueue();
    const prisma = makePrisma(() => Promise.reject(new Error('db down')));
    const trigger = new ArchiveSummaryTrigger(prisma, queue, () => true);

    await expect(
      trigger.enqueue({ memoryId: MEMORY_ID, personalityId: PERSONALITY_ID, reason: 'write' })
    ).resolves.toBeUndefined();
  });
});
