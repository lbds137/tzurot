import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitForDeploymentRemoved } from './deployment-removal-wait.js';
import { MAX_CONSECUTIVE_POLL_ERRORS } from './service-redeploy-wait.js';

describe('waitForDeploymentRemoved', () => {
  let clock = 0;
  const sleep = vi.fn(async (ms: number) => {
    clock += ms;
  });
  const now = () => clock;
  let pending: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clock = 0;
    sleep.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  function run(
    statuses: (string | Error)[],
    overrides: { timeoutMs?: number } = {}
  ): Promise<void> {
    const queue = [...statuses];
    const getDeploymentStatus = vi.fn(async () => {
      const next = queue.length > 1 ? queue.shift()! : queue[0]!;
      if (next instanceof Error) {
        throw next;
      }
      return next;
    });
    pending = getDeploymentStatus;
    return waitForDeploymentRemoved({
      deploymentId: 'old-dep',
      serviceName: 'api-gateway',
      env: 'dev',
      rerunNote: 'RERUN-NOTE',
      pollIntervalMs: 10,
      timeoutMs: overrides.timeoutMs ?? 1000,
      getDeploymentStatus,
      sleep,
      now,
    });
  }

  it('polls the given deployment id and returns on REMOVED', async () => {
    await run(['REMOVED']);

    expect(pending).toHaveBeenCalledWith({ deploymentId: 'old-dep', env: 'dev' });
  });

  it('keeps waiting through REMOVING and SUCCESS until REMOVED', async () => {
    await run(['SUCCESS', 'REMOVING', 'REMOVING', 'REMOVED']);

    expect(pending).toHaveBeenCalledTimes(4);
  });

  it('times out when the deployment stays SUCCESS, naming the rerun note', async () => {
    await expect(run(['SUCCESS'], { timeoutMs: 100 })).rejects.toThrow(
      /Timed out after 0s waiting for api-gateway's previous deployment old-dep \(dev\) to reach REMOVED \(last observed status: SUCCESS\).*RERUN-NOTE/s
    );
  });

  it('never treats REMOVING as done (times out)', async () => {
    await expect(run(['REMOVING'], { timeoutMs: 100 })).rejects.toThrow(
      /last observed status: REMOVING/
    );
  });

  it('returns on FAILED, a not-live status shared with the pre-swap check', async () => {
    await run(['FAILED']);

    expect(pending).toHaveBeenCalledTimes(1);
  });

  it('returns on SKIPPED, a not-live status shared with the pre-swap check', async () => {
    await run(['SKIPPED']);

    expect(pending).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting through CRASHED and times out, naming CRASHED and the dashboard step', async () => {
    await expect(run(['CRASHED'], { timeoutMs: 100 })).rejects.toThrow(
      /\(last observed status: CRASHED\).*CRASHED counts as possibly live.*Railway dashboard.*RERUN-NOTE/s
    );
  });

  it('tolerates up to MAX consecutive status-read errors, then succeeds', async () => {
    const errors = Array.from({ length: MAX_CONSECUTIVE_POLL_ERRORS }, () => new Error('net'));
    await run([...errors, 'REMOVED']);

    expect(pending).toHaveBeenCalledTimes(MAX_CONSECUTIVE_POLL_ERRORS + 1);
  });

  it('throws after more than MAX consecutive status-read errors', async () => {
    await expect(run([new Error('net down')])).rejects.toThrow(
      new RegExp(
        `failed ${MAX_CONSECUTIVE_POLL_ERRORS + 1} consecutive times \\(last error: net down\\).*RERUN-NOTE`,
        's'
      )
    );
  });

  it('resets the error streak after a successful read', async () => {
    const burst = Array.from({ length: MAX_CONSECUTIVE_POLL_ERRORS }, () => new Error('net'));
    await run([...burst, 'SUCCESS', ...burst, 'REMOVED']);

    expect(pending).toHaveBeenCalledTimes(burst.length * 2 + 2);
  });
});
