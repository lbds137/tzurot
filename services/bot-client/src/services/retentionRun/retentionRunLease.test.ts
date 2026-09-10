/**
 * Tests for the job-side run-lease helpers (the bot-client mirror of the
 * tooling CLI's runLease.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted: vi.mock factories run before ordinary top-level `const`s, so a
// plain `const mockWarn = vi.fn()` above is not yet initialized when this
// factory executes.
const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));
vi.mock('@tzurot/common-types/utils/logger', () => ({
  createLogger: () => ({ warn: mockWarn, info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import {
  beginRetentionRunLease,
  releaseRetentionRunLease,
  isRetentionRunLeaseLost,
  type RetentionRunLeaseClient,
} from './retentionRunLease.js';

const RUN_ID = '3f2b8c1e-9d4a-4c5b-8e7f-1a2b3c4d5e6f';

function makeClient(): RetentionRunLeaseClient & {
  retentionRunBegin: ReturnType<typeof vi.fn>;
  retentionRunEnd: ReturnType<typeof vi.fn>;
} {
  return {
    retentionRunBegin: vi.fn(),
    retentionRunEnd: vi.fn(),
  } as unknown as RetentionRunLeaseClient & {
    retentionRunBegin: ReturnType<typeof vi.fn>;
    retentionRunEnd: ReturnType<typeof vi.fn>;
  };
}

describe('beginRetentionRunLease', () => {
  it('returns acquired with the runId on success', async () => {
    const client = makeClient();
    client.retentionRunBegin.mockResolvedValue({
      ok: true,
      data: { runId: RUN_ID, leaseTtlMs: 600000 },
    });

    const result = await beginRetentionRunLease(client, 'job:retention-daily');

    expect(result).toEqual({ kind: 'acquired', runId: RUN_ID });
    expect(client.retentionRunBegin).toHaveBeenCalledWith({ runContext: 'job:retention-daily' });
  });

  it('returns busy with the holder message on RUN_IN_PROGRESS', async () => {
    const client = makeClient();
    client.retentionRunBegin.mockResolvedValue({
      ok: false,
      kind: 'http',
      error: 'Another retention run is in progress: "cli run" (since 2026-01-01T00:00:00.000Z).',
      code: 'RUN_IN_PROGRESS',
    });

    const result = await beginRetentionRunLease(client, 'job:retention-daily');

    expect(result).toEqual({
      kind: 'busy',
      holder: 'Another retention run is in progress: "cli run" (since 2026-01-01T00:00:00.000Z).',
    });
  });

  it('returns failed for any other ok:false result', async () => {
    const client = makeClient();
    client.retentionRunBegin.mockResolvedValue({
      ok: false,
      kind: 'network',
      error: 'ECONNREFUSED',
    });

    const result = await beginRetentionRunLease(client, 'job:retention-daily');

    expect(result).toEqual({ kind: 'failed', error: 'ECONNREFUSED' });
  });

  it('returns failed when the call throws (never throws itself)', async () => {
    const client = makeClient();
    client.retentionRunBegin.mockRejectedValue(new Error('boom'));

    const result = await beginRetentionRunLease(client, 'job:retention-daily');

    expect(result).toEqual({ kind: 'failed', error: 'boom' });
  });

  it('returns failed with String(error) for a non-Error throw', async () => {
    const client = makeClient();
    client.retentionRunBegin.mockRejectedValue('a plain string');

    const result = await beginRetentionRunLease(client, 'job:retention-daily');

    expect(result).toEqual({ kind: 'failed', error: 'a plain string' });
  });
});

describe('releaseRetentionRunLease', () => {
  beforeEach(() => {
    mockWarn.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls retentionRunEnd with the runId', async () => {
    const client = makeClient();
    client.retentionRunEnd.mockResolvedValue({ ok: true, data: { released: true } });

    await releaseRetentionRunLease(client, RUN_ID);

    expect(client.retentionRunEnd).toHaveBeenCalledWith({ runId: RUN_ID });
  });

  it('does not warn when the lease was released cleanly', async () => {
    const client = makeClient();
    client.retentionRunEnd.mockResolvedValue({ ok: true, data: { released: true } });

    await releaseRetentionRunLease(client, RUN_ID);

    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('warns when the release call fails', async () => {
    const client = makeClient();
    client.retentionRunEnd.mockResolvedValue({ ok: false, kind: 'network', error: 'ECONNREFUSED' });

    await releaseRetentionRunLease(client, RUN_ID);

    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: RUN_ID }),
      expect.any(String)
    );
    const [fields, message] = mockWarn.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields).toMatchObject({ kind: 'network', error: 'ECONNREFUSED' });
    expect(message).toContain('lease TTL reclaims it');
  });

  it("warns when released is false (lease was no longer this run's)", async () => {
    const client = makeClient();
    client.retentionRunEnd.mockResolvedValue({ ok: true, data: { released: false } });

    await releaseRetentionRunLease(client, RUN_ID);

    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: RUN_ID }),
      expect.any(String)
    );
    const [, message] = mockWarn.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toContain('no longer this run');
    expect(message).toContain('overlapped');
  });

  it('swallows a rejection — best effort, resolves undefined — and warns', async () => {
    const client = makeClient();
    client.retentionRunEnd.mockRejectedValue(new Error('network down'));

    await expect(releaseRetentionRunLease(client, RUN_ID)).resolves.toBeUndefined();

    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: RUN_ID }),
      expect.any(String)
    );
    const [fields] = mockWarn.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ err: expect.any(Error) as Error });
  });
});

describe('isRetentionRunLeaseLost', () => {
  it('is true only for a RUN_LEASE_CONFLICT failure', () => {
    expect(isRetentionRunLeaseLost({ ok: false, code: 'RUN_LEASE_CONFLICT' })).toBe(true);
  });

  it('is false for an ok result', () => {
    expect(isRetentionRunLeaseLost({ ok: true })).toBe(false);
  });

  it('is false for a failure with a different code', () => {
    expect(isRetentionRunLeaseLost({ ok: false, code: 'RUN_IN_PROGRESS' })).toBe(false);
  });

  it('is false for a failure with no code at all', () => {
    expect(isRetentionRunLeaseLost({ ok: false })).toBe(false);
  });
});
