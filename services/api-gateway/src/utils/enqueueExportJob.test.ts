import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Queue } from 'bullmq';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

const loggerWarnMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: loggerWarnMock,
      error: loggerErrorMock,
    }),
  };
});

import { enqueueExportJobOrMarkFailed } from './enqueueExportJob.js';

const queueAdd = vi.fn();
const exportJobUpdate = vi.fn();
const queue = { add: queueAdd } as unknown as Queue;
const prisma = { exportJob: { update: exportJobUpdate } } as unknown as PrismaClient;

const OPTS = {
  queue,
  prisma,
  exportJobId: 'export-1',
  jobName: 'AccountExport',
  jobData: { userId: 'u1', exportJobId: 'export-1' },
  jobOptions: { jobId: 'job-1', attempts: 3 },
};

describe('enqueueExportJobOrMarkFailed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueAdd.mockResolvedValue({});
    exportJobUpdate.mockResolvedValue({});
  });

  it('passes name, data, and options through to queue.add on success', async () => {
    await enqueueExportJobOrMarkFailed(OPTS);

    expect(queueAdd).toHaveBeenCalledWith(
      'AccountExport',
      { userId: 'u1', exportJobId: 'export-1' },
      { jobId: 'job-1', attempts: 3 }
    );
    expect(exportJobUpdate).not.toHaveBeenCalled();
  });

  it('marks the row failed and rethrows when the enqueue throws', async () => {
    queueAdd.mockRejectedValue(new Error('redis connection refused'));

    await expect(enqueueExportJobOrMarkFailed(OPTS)).rejects.toThrow('redis connection refused');

    // The whole point: the pending row must not be left to 409 until expiry.
    // The stored message must be GENERIC — the shapes list route returns
    // errorMessage verbatim to users, so the raw error (which can carry
    // connection detail) must never be written to the row.
    expect(exportJobUpdate).toHaveBeenCalledWith({
      where: { id: 'export-1' },
      data: {
        status: 'failed',
        errorMessage: 'Failed to queue the export job — please retry.',
      },
    });
    const storedMessage = exportJobUpdate.mock.calls[0][0].data.errorMessage as string;
    expect(storedMessage).not.toContain('redis connection refused');
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), exportJobId: 'export-1' }),
      expect.stringContaining('marked failed')
    );
  });

  it('still rethrows the ORIGINAL error when the failure-marking update also fails', async () => {
    queueAdd.mockRejectedValue(new Error('redis connection refused'));
    exportJobUpdate.mockRejectedValue(new Error('db also down'));

    await expect(enqueueExportJobOrMarkFailed(OPTS)).rejects.toThrow('redis connection refused');

    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), exportJobId: 'export-1' }),
      expect.stringContaining('409 until expiry')
    );
  });
});
