import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  loadArchiveSummaryRow,
  writeArchiveSummarySuccess,
  writeArchiveSummaryFailure,
  writeArchiveSummaryNoTemplate,
} from './archiveSummaryStore.js';

const MEMORY_ID = '4f9b0f66-3333-4000-8000-00000000000a';

function makePrisma(queryRawResult: unknown[]): PrismaClient {
  return {
    $queryRaw: vi.fn().mockResolvedValue(queryRawResult),
    $executeRaw: vi.fn().mockResolvedValue(1),
  } as unknown as PrismaClient;
}

describe('loadArchiveSummaryRow', () => {
  it('maps the raw snake_case row to the camelCase shape', async () => {
    const prisma = makePrisma([
      {
        id: MEMORY_ID,
        content: '{user}: hi\n{assistant}: hello',
        personality_id: 'pid',
        persona_id: 'persid',
        owner_id: 'ownerid',
        summary_status: null,
        summary_attempts: 0,
        source_content_hash: null,
        summary_prompt_version: null,
        persona_name: 'Jules',
        personality_name: 'Nova',
      },
    ]);

    const row = await loadArchiveSummaryRow(prisma, MEMORY_ID);
    expect(row).toEqual({
      id: MEMORY_ID,
      content: '{user}: hi\n{assistant}: hello',
      personalityId: 'pid',
      personaId: 'persid',
      ownerId: 'ownerid',
      summaryStatus: null,
      summaryAttempts: 0,
      sourceContentHash: null,
      summaryPromptVersion: null,
      personaName: 'Jules',
      personalityName: 'Nova',
    });
  });

  it('returns null when no row is found', async () => {
    const prisma = makePrisma([]);
    await expect(loadArchiveSummaryRow(prisma, MEMORY_ID)).resolves.toBeNull();
  });
});

const EXPECTED_CONTENT = '{user}: hi\n{assistant}: hello';

function lastExecuteRawArgs(prisma: PrismaClient): unknown[] {
  const calls = (prisma.$executeRaw as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1] as unknown[];
}

describe('writeArchiveSummarySuccess', () => {
  it('issues a content-guarded UPDATE with the success fields and returns the affected count', async () => {
    const prisma = makePrisma([]);
    await expect(
      writeArchiveSummarySuccess(prisma, {
        memoryId: MEMORY_ID,
        expectedContent: EXPECTED_CONTENT,
        summary: 'A summary.',
        model: 'z-ai/glm-5.2',
        promptVersion: 1,
        sourceContentHash: 'abc123',
      })
    ).resolves.toBe(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(lastExecuteRawArgs(prisma).slice(1)).toContain(EXPECTED_CONTENT);
  });

  it('returns 0 when the content guard matches no row', async () => {
    const prisma = makePrisma([]);
    (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0);
    await expect(
      writeArchiveSummarySuccess(prisma, {
        memoryId: MEMORY_ID,
        expectedContent: EXPECTED_CONTENT,
        summary: 'A summary.',
        model: 'z-ai/glm-5.2',
        promptVersion: 1,
        sourceContentHash: 'abc123',
      })
    ).resolves.toBe(0);
  });
});

describe('writeArchiveSummaryFailure', () => {
  it('issues a content-guarded UPDATE with the billed-failure fields and returns the affected count', async () => {
    const prisma = makePrisma([]);
    await expect(
      writeArchiveSummaryFailure(prisma, {
        memoryId: MEMORY_ID,
        expectedContent: EXPECTED_CONTENT,
        sourceContentHash: 'abc123',
        errorClass: 'parse_failure',
        promptVersion: 1,
      })
    ).resolves.toBe(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(lastExecuteRawArgs(prisma).slice(1)).toContain(EXPECTED_CONTENT);
    expect(lastExecuteRawArgs(prisma).slice(1)).toContain(1);
  });

  it('returns 0 when the content guard matches no row', async () => {
    const prisma = makePrisma([]);
    (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0);
    await expect(
      writeArchiveSummaryFailure(prisma, {
        memoryId: MEMORY_ID,
        expectedContent: EXPECTED_CONTENT,
        sourceContentHash: 'abc123',
        errorClass: 'parse_failure',
        promptVersion: 1,
      })
    ).resolves.toBe(0);
  });
});

describe('writeArchiveSummaryNoTemplate', () => {
  it('issues a content-guarded UPDATE marking the row dead/no_template and returns the affected count', async () => {
    const prisma = makePrisma([]);
    await expect(
      writeArchiveSummaryNoTemplate(prisma, {
        memoryId: MEMORY_ID,
        expectedContent: EXPECTED_CONTENT,
        sourceContentHash: 'abc123',
        promptVersion: 1,
      })
    ).resolves.toBe(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(lastExecuteRawArgs(prisma).slice(1)).toContain(EXPECTED_CONTENT);
    expect(lastExecuteRawArgs(prisma).slice(1)).toContain(1);
  });

  it('returns 0 when the content guard matches no row', async () => {
    const prisma = makePrisma([]);
    (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0);
    await expect(
      writeArchiveSummaryNoTemplate(prisma, {
        memoryId: MEMORY_ID,
        expectedContent: EXPECTED_CONTENT,
        sourceContentHash: 'abc123',
        promptVersion: 1,
      })
    ).resolves.toBe(0);
  });
});
