import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { AccountExportJobData } from '@tzurot/common-types/types/account-export';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const assembleMock = vi.hoisted(() => vi.fn());
vi.mock('./AccountExportAssembler.js', () => ({
  assembleAccountExport: assembleMock,
}));

import { processAccountExportJob } from './AccountExportJob.js';

const mockPrisma = {
  exportJob: { update: vi.fn().mockResolvedValue({}) },
} as unknown as PrismaClient;

function makeJob(
  attempt: { attemptsMade?: number; attempts?: number } = {}
): Job<AccountExportJobData> {
  return {
    id: 'bullmq-1',
    data: { userId: 'user-uuid-1', exportJobId: 'export-job-1' },
    attemptsMade: attempt.attemptsMade ?? 0,
    opts: { attempts: attempt.attempts ?? 1 },
  } as unknown as Job<AccountExportJobData>;
}

function makePayload(): Record<string, unknown> {
  return {
    meta: { exportedAt: 'now', formatVersion: 1, notes: [] },
    profile: { username: 'alice' },
    personas: [{}],
    characters: [],
    conversationHistory: [{}, {}],
    memories: [{}],
    facts: [],
    feedback: [],
  };
}

describe('processAccountExportJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('transitions pending → in_progress → completed with content and metadata', async () => {
    assembleMock.mockResolvedValue(makePayload());

    const result = await processAccountExportJob(makeJob(), mockPrisma);

    expect(result.success).toBe(true);
    expect(result.fileSizeBytes).toBeGreaterThan(0);

    const updates = (mockPrisma.exportJob.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(updates[0][0].data.status).toBe('in_progress');
    const final = updates[1][0].data;
    expect(final.status).toBe('completed');
    expect(final.fileName).toMatch(/^tzurot-account-export-alice-\d{4}-\d{2}-\d{2}\.json$/);
    expect(final.exportMetadata).toEqual(
      expect.objectContaining({ conversationHistory: 2, memories: 1, personas: 1 })
    );
    // The stored content is the assembled payload, serialized.
    expect(JSON.parse(final.fileContent).profile.username).toBe('alice');
  });

  it('sanitizes usernames that are not filename-safe', async () => {
    assembleMock.mockResolvedValue({ ...makePayload(), profile: { username: 'a/б c!' } });

    await processAccountExportJob(makeJob(), mockPrisma);

    const final = (mockPrisma.exportJob.update as ReturnType<typeof vi.fn>).mock.calls[1][0].data;
    expect(final.fileName).not.toMatch(/[/!\s]/);
  });

  it('re-throws on non-final attempts so BullMQ actually retries (row stays in_progress)', async () => {
    assembleMock.mockRejectedValue(new Error('transient pool timeout'));

    await expect(
      processAccountExportJob(makeJob({ attemptsMade: 0, attempts: 3 }), mockPrisma)
    ).rejects.toThrow('transient pool timeout');

    // Only the in_progress transition ran — the row was NOT marked failed.
    const updates = (mockPrisma.exportJob.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(updates).toHaveLength(1);
    expect(updates[0][0].data.status).toBe('in_progress');
  });

  it('marks the row failed (with the error message) only on the final attempt', async () => {
    assembleMock.mockRejectedValue(new Error('db exploded'));

    const result = await processAccountExportJob(
      makeJob({ attemptsMade: 2, attempts: 3 }),
      mockPrisma
    );

    expect(result).toEqual({ success: false, fileSizeBytes: 0, error: 'db exploded' });
    const final = (mockPrisma.exportJob.update as ReturnType<typeof vi.fn>).mock.calls[1][0].data;
    expect(final.status).toBe('failed');
    expect(final.errorMessage).toBe('db exploded');
  });
});
