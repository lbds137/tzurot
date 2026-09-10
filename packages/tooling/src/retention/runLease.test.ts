import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { beginRunLease, releaseRunLease, isRunLeaseLost, type RunLeaseClient } from './runLease.js';

const RUN_ID = '3f2b8c1e-9d4a-4c5b-8e7f-1a2b3c4d5e6f';

function makeClient(): RunLeaseClient & {
  retentionRunBegin: ReturnType<typeof vi.fn<RunLeaseClient['retentionRunBegin']>>;
  retentionRunEnd: ReturnType<typeof vi.fn<RunLeaseClient['retentionRunEnd']>>;
} {
  return {
    retentionRunBegin: vi.fn<RunLeaseClient['retentionRunBegin']>(),
    retentionRunEnd: vi.fn<RunLeaseClient['retentionRunEnd']>(),
  };
}

describe('beginRunLease', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('returns the runId on success', async () => {
    const client = makeClient();
    client.retentionRunBegin.mockResolvedValue({
      ok: true,
      data: { runId: RUN_ID, leaseTtlMs: 600000 },
    });

    const result = await beginRunLease(client, 'ops retention:purge (dev)');

    expect(result).toBe(RUN_ID);
    expect(client.retentionRunBegin).toHaveBeenCalledWith({
      runContext: 'ops retention:purge (dev)',
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('returns null, sets exitCode 1, and prints the server message on RUN_IN_PROGRESS', async () => {
    const client = makeClient();
    client.retentionRunBegin.mockResolvedValue({
      ok: false,
      kind: 'http',
      error: 'Another retention run is in progress: "other run" (since 2026-01-01T00:00:00.000Z).',
      code: 'RUN_IN_PROGRESS',
    });

    const result = await beginRunLease(client, 'ops retention:purge (dev)');

    expect(result).toBeNull();
    expect(process.exitCode).toBe(1);
    const output = errorSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Another retention run is in progress');
  });

  it('returns null, sets exitCode 1, and names the failure kind for any other failure', async () => {
    const client = makeClient();
    client.retentionRunBegin.mockResolvedValue({
      ok: false,
      kind: 'network',
      error: 'ECONNREFUSED',
    });

    const result = await beginRunLease(client, 'ops retention:purge (dev)');

    expect(result).toBeNull();
    expect(process.exitCode).toBe(1);
    const output = errorSpy.mock.calls.flat().join('\n');
    expect(output).toContain('network');
    expect(output).toContain('ECONNREFUSED');
  });
});

describe('releaseRunLease', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('calls retentionRunEnd with the runId', async () => {
    const client = makeClient();
    client.retentionRunEnd.mockResolvedValue({ ok: true, data: { released: true } });

    await releaseRunLease(client, RUN_ID);

    expect(client.retentionRunEnd).toHaveBeenCalledWith({ runId: RUN_ID });
  });

  it('does not warn when the lease was released cleanly', async () => {
    const client = makeClient();
    client.retentionRunEnd.mockResolvedValue({ ok: true, data: { released: true } });

    await releaseRunLease(client, RUN_ID);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('warns naming the kind and error when the release call fails', async () => {
    const client = makeClient();
    client.retentionRunEnd.mockResolvedValue({
      ok: false,
      kind: 'network',
      error: 'ECONNREFUSED',
    });

    await releaseRunLease(client, RUN_ID);

    const output = warnSpy.mock.calls.flat().join('\n');
    expect(output).toContain('network');
    expect(output).toContain('ECONNREFUSED');
    expect(output).toContain('lease TTL reclaims');
    expect(process.exitCode).toBeUndefined();
  });

  it("warns that the lease was no longer this run's when released: false", async () => {
    const client = makeClient();
    client.retentionRunEnd.mockResolvedValue({ ok: true, data: { released: false } });

    await releaseRunLease(client, RUN_ID);

    const output = warnSpy.mock.calls.flat().join('\n');
    expect(output).toContain('no longer this run');
    expect(output).toContain('overlapped');
    expect(process.exitCode).toBeUndefined();
  });

  it('warns with the error message when the call throws, and swallows it — best effort, resolves undefined', async () => {
    const client = makeClient();
    client.retentionRunEnd.mockRejectedValue(new Error('network down'));

    await expect(releaseRunLease(client, RUN_ID)).resolves.toBeUndefined();

    const output = warnSpy.mock.calls.flat().join('\n');
    expect(output).toContain('network down');
    expect(output).toContain('lease TTL reclaims');
    expect(process.exitCode).toBeUndefined();
  });

  it('warns with String(error) when a non-Error is thrown', async () => {
    const client = makeClient();
    client.retentionRunEnd.mockRejectedValue('a plain string rejection');

    await releaseRunLease(client, RUN_ID);

    const output = warnSpy.mock.calls.flat().join('\n');
    expect(output).toContain('a plain string rejection');
  });
});

describe('isRunLeaseLost', () => {
  it('is true only for an RUN_LEASE_CONFLICT failure', () => {
    expect(isRunLeaseLost({ ok: false, code: 'RUN_LEASE_CONFLICT' })).toBe(true);
  });

  it('is false for an ok result', () => {
    expect(isRunLeaseLost({ ok: true })).toBe(false);
  });

  it('is false for a failure with a different code', () => {
    expect(isRunLeaseLost({ ok: false, code: 'RUN_IN_PROGRESS' })).toBe(false);
  });

  it('is false for a failure with no code at all', () => {
    expect(isRunLeaseLost({ ok: false })).toBe(false);
  });
});
