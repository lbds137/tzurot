import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  assertPresentersStillReady,
  DEFAULT_VERIFIER_POLL_INTERVAL_MS,
  DEFAULT_VERIFIER_WAIT_TIMEOUT_MS,
  MAX_CONSECUTIVE_POLL_ERRORS,
  redeployAndWaitForVerifier,
} from './verifier-redeploy-wait.js';

const VERIFIER = { id: 'svc-gateway', name: 'api-gateway' };

describe('redeployAndWaitForVerifier', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls past the old deployment id and intermediate BUILDING state until the new deployment id reaches SUCCESS', async () => {
    const redeploy = vi
      .fn()
      .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' });
    const getLatestDeployment = vi
      .fn()
      .mockResolvedValueOnce({ id: 'dep-old', status: 'SUCCESS' })
      .mockResolvedValueOnce({ id: 'dep-old', status: 'SUCCESS' })
      .mockResolvedValueOnce({ id: 'dep-new', status: 'BUILDING' })
      .mockResolvedValueOnce({ id: 'dep-new', status: 'DEPLOYING' })
      .mockResolvedValueOnce({ id: 'dep-new', status: 'SUCCESS' });

    const promise = redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'dev',
      redeploy,
      getLatestDeployment,
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_VERIFIER_POLL_INTERVAL_MS * 4);
    const result = await promise;

    expect(result).toBe('dep-new');
    expect(redeploy).toHaveBeenCalledTimes(1);
    expect(redeploy).toHaveBeenCalledWith({
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      serviceName: 'api-gateway',
      env: 'dev',
    });
    expect(getLatestDeployment).toHaveBeenCalledTimes(5);
    expect(getLatestDeployment).toHaveBeenCalledWith({
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      env: 'dev',
    });
  });

  it('never treats a stale SUCCESS deployment id as completion when the new deployment subsequently fails', async () => {
    const redeploy = vi
      .fn()
      .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' });
    const getLatestDeployment = vi
      .fn()
      .mockResolvedValueOnce({ id: 'dep-old', status: 'SUCCESS' })
      .mockResolvedValueOnce({ id: 'dep-new', status: 'FAILED' });

    const caughtPromise = redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'dev',
      redeploy,
      getLatestDeployment,
    }).catch((err: unknown) => err);

    await vi.advanceTimersByTimeAsync(DEFAULT_VERIFIER_POLL_INTERVAL_MS);
    const caught = await caughtPromise;

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('api-gateway');
    expect(message).toContain('FAILED');
    expect(message).toContain('nothing was redeployed on presenters');
    expect(message).toMatch(/re-running stage 2 is safe/i);
    expect(getLatestDeployment).toHaveBeenCalledTimes(2);
  });

  it('times out and refuses when latestDeployment stays on the old SUCCESS deployment id for the full timeout window', async () => {
    const redeploy = vi
      .fn()
      .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' });
    const getLatestDeployment = vi.fn().mockResolvedValue({ id: 'dep-old', status: 'SUCCESS' });

    const caughtPromise = redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'prod',
      redeploy,
      getLatestDeployment,
    }).catch((err: unknown) => err);

    await vi.advanceTimersByTimeAsync(DEFAULT_VERIFIER_WAIT_TIMEOUT_MS);
    const caught = await caughtPromise;

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('Timed out after 600s');
    expect(message).toContain('api-gateway');
    expect(message).toContain('previous deployment (SUCCESS)');
    expect(message).toContain('nothing was redeployed on presenters');
    expect(message).toMatch(/re-running stage 2 is safe/i);
  });

  it.each(['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED'])(
    'refuses immediately without further polling when the new deployment reaches terminal status %s',
    async status => {
      const redeploy = vi
        .fn()
        .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' });
      const getLatestDeployment = vi.fn().mockResolvedValue({ id: 'dep-new', status });
      const sleep = vi.fn().mockResolvedValue(undefined);
      let t = 0;

      const caught = await redeployAndWaitForVerifier({
        environmentId: 'env-1',
        verifier: VERIFIER,
        env: 'dev',
        timeoutMs: 1000,
        redeploy,
        getLatestDeployment,
        sleep,
        now: () => (t += 500),
      }).catch((err: unknown) => err);

      expect(caught).toBeInstanceOf(Error);
      const message = (caught as Error).message;
      expect(message).toContain('api-gateway');
      expect(message).toContain(status);
      expect(message).toContain('nothing was redeployed on presenters');
      expect(message).toMatch(/re-running stage 2 is safe/i);
      expect(getLatestDeployment).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  );

  it('ignores a terminal status on the prior deployment id while waiting for the new deployment id to appear', async () => {
    const redeploy = vi
      .fn()
      .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' });
    const getLatestDeployment = vi
      .fn()
      .mockResolvedValueOnce({ id: 'dep-old', status: 'REMOVED' })
      .mockResolvedValueOnce({ id: 'dep-new', status: 'SUCCESS' });

    const promise = redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'dev',
      redeploy,
      getLatestDeployment,
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_VERIFIER_POLL_INTERVAL_MS);
    await expect(promise).resolves.toBe('dep-new');
    expect(getLatestDeployment).toHaveBeenCalledTimes(2);
  });

  it('times out after the default 10-minute budget when the new deployment remains BUILDING', async () => {
    const redeploy = vi
      .fn()
      .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' });
    const getLatestDeployment = vi.fn().mockResolvedValue({ id: 'dep-new', status: 'BUILDING' });

    const caughtPromise = redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'dev',
      redeploy,
      getLatestDeployment,
    }).catch((err: unknown) => err);

    await vi.advanceTimersByTimeAsync(DEFAULT_VERIFIER_WAIT_TIMEOUT_MS);
    const caught = await caughtPromise;

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('Timed out after 600s');
    expect(message).toContain('api-gateway');
    expect(message).toContain('last observed status: BUILDING');
    expect(message).toContain('nothing was redeployed on presenters');
    expect(message).toMatch(/re-running stage 2 is safe/i);
  });

  it('reports missing as the observed status when latestDeployment is null until timeout', async () => {
    const redeploy = vi
      .fn()
      .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' });
    const getLatestDeployment = vi.fn().mockResolvedValue(null);

    const caughtPromise = redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'dev',
      timeoutMs: 10_000,
      pollIntervalMs: 5_000,
      redeploy,
      getLatestDeployment,
    }).catch((err: unknown) => err);

    await vi.advanceTimersByTimeAsync(10_000);
    const caught = await caughtPromise;

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('last observed status: missing');
    expect(message).toContain('nothing was redeployed on presenters');
  });

  it('tolerates two consecutive getLatestDeployment rejections and returns the new deployment id when polling recovers', async () => {
    const redeploy = vi
      .fn()
      .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' });
    const getLatestDeployment = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient network failure 1'))
      .mockRejectedValueOnce(new Error('transient network failure 2'))
      .mockResolvedValueOnce({ id: 'dep-new', status: 'SUCCESS' });

    const promise = redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'dev',
      redeploy,
      getLatestDeployment,
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_VERIFIER_POLL_INTERVAL_MS * 2);
    await expect(promise).resolves.toBe('dep-new');
    expect(getLatestDeployment).toHaveBeenCalledTimes(3);
  });

  it('resets the consecutive poll error counter on a successful poll so non-consecutive errors never trip the limit', async () => {
    const redeploy = vi
      .fn()
      .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' });
    const getLatestDeployment = vi
      .fn()
      .mockRejectedValueOnce(new Error('glitch 1'))
      .mockResolvedValueOnce({ id: 'dep-old', status: 'SUCCESS' })
      .mockRejectedValueOnce(new Error('glitch 2'))
      .mockResolvedValueOnce({ id: 'dep-old', status: 'SUCCESS' })
      .mockRejectedValueOnce(new Error('glitch 3'))
      .mockResolvedValueOnce({ id: 'dep-old', status: 'SUCCESS' })
      .mockRejectedValueOnce(new Error('glitch 4'))
      .mockResolvedValueOnce({ id: 'dep-new', status: 'SUCCESS' });

    const promise = redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'dev',
      redeploy,
      getLatestDeployment,
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_VERIFIER_POLL_INTERVAL_MS * 7);
    await expect(promise).resolves.toBe('dep-new');
    expect(getLatestDeployment).toHaveBeenCalledTimes(8);
  });

  it('throws on the fourth consecutive poll rejection with the verifier name and safe-rerun note and omits non-Error rejection values', async () => {
    const redeploy = vi
      .fn()
      .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' });
    const getLatestDeployment = vi
      .fn()
      .mockRejectedValueOnce(new Error('glitch 1'))
      .mockRejectedValueOnce(new Error('glitch 2'))
      .mockRejectedValueOnce(new Error('glitch 3'))
      .mockRejectedValueOnce('raw rejection carrying SENTINEL-TOKEN-VALUE');

    const caughtPromise = redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'dev',
      redeploy,
      getLatestDeployment,
    }).catch((err: unknown) => err);

    await vi.advanceTimersByTimeAsync(
      DEFAULT_VERIFIER_POLL_INTERVAL_MS * MAX_CONSECUTIVE_POLL_ERRORS
    );
    const caught = await caughtPromise;

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('api-gateway');
    expect(message).toContain('dev');
    expect(message).toContain('nothing was redeployed on presenters');
    expect(message).toMatch(/re-running stage 2 is safe/i);
    expect(message).not.toContain('SENTINEL-TOKEN-VALUE');
    // MAX_CONSECUTIVE_POLL_ERRORS tolerated poll rejections + 1 final poll rejection that trips the limit.
    expect(getLatestDeployment).toHaveBeenCalledTimes(MAX_CONSECUTIVE_POLL_ERRORS + 1);
  });

  it('includes the last Error message when the fourth consecutive poll rejection is an Error instance', async () => {
    const redeploy = vi
      .fn()
      .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' });
    const getLatestDeployment = vi
      .fn()
      .mockRejectedValueOnce(new Error('glitch 1'))
      .mockRejectedValueOnce(new Error('glitch 2'))
      .mockRejectedValueOnce(new Error('glitch 3'))
      .mockRejectedValueOnce(new Error('Railway GraphQL 502 Bad Gateway'));

    const caughtPromise = redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'prod',
      redeploy,
      getLatestDeployment,
    }).catch((err: unknown) => err);

    await vi.advanceTimersByTimeAsync(
      DEFAULT_VERIFIER_POLL_INTERVAL_MS * MAX_CONSECUTIVE_POLL_ERRORS
    );
    const caught = await caughtPromise;

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('api-gateway');
    expect(message).toContain('prod');
    expect(message).toContain('Railway GraphQL 502 Bad Gateway');
    expect(message).toContain('nothing was redeployed on presenters');
    expect(message).toMatch(/re-running stage 2 is safe/i);
  });

  it('refuses immediately without sleeping when the new deployment status is NEEDS_APPROVAL', async () => {
    const redeploy = vi
      .fn()
      .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' });
    const getLatestDeployment = vi
      .fn()
      .mockResolvedValue({ id: 'dep-new', status: 'NEEDS_APPROVAL' });
    const sleep = vi.fn().mockResolvedValue(undefined);
    let t = 0;

    const caught = await redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'prod',
      timeoutMs: 1000,
      redeploy,
      getLatestDeployment,
      sleep,
      now: () => (t += 500),
    }).catch((err: unknown) => err);

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('api-gateway');
    expect(message).toContain('NEEDS_APPROVAL');
    expect(message).toContain('nothing was redeployed on presenters');
    expect(message).toMatch(/re-running stage 2 is safe/i);
    expect(getLatestDeployment).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('prints the start progress line with the new deployment id and logs each new-deployment status change once rather than per poll', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const redeploy = vi
      .fn()
      .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' });
    const getLatestDeployment = vi
      .fn()
      .mockResolvedValueOnce({ id: 'dep-old', status: 'SUCCESS' })
      .mockResolvedValueOnce({ id: 'dep-new', status: 'BUILDING' })
      .mockResolvedValueOnce({ id: 'dep-new', status: 'BUILDING' })
      .mockResolvedValueOnce({ id: 'dep-new', status: 'BUILDING' })
      .mockResolvedValueOnce({ id: 'dep-new', status: 'DEPLOYING' })
      .mockResolvedValueOnce({ id: 'dep-new', status: 'DEPLOYING' })
      .mockResolvedValueOnce({ id: 'dep-new', status: 'SUCCESS' });

    const promise = redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'dev',
      redeploy,
      getLatestDeployment,
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_VERIFIER_POLL_INTERVAL_MS * 6);
    await expect(promise).resolves.toBe('dep-new');

    const lines = logSpy.mock.calls.flat().map(String);
    expect(lines[0]).toContain('Redeployed "api-gateway" (dep-new); waiting for SUCCESS…');
    expect(lines.filter((line: string) => line.includes('BUILDING'))).toHaveLength(1);
    expect(lines.filter((line: string) => line.includes('DEPLOYING'))).toHaveLength(1);
    expect(lines.join('\n')).not.toContain('dep-old');
  });

  it('wraps a redeploy Error rejection with the verifier name, original message, and safe-rerun note without polling', async () => {
    const redeploy = vi.fn().mockRejectedValue(new Error('deploymentRedeploy mutation failed'));
    const getLatestDeployment = vi.fn();

    const caught = await redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'dev',
      redeploy,
      getLatestDeployment,
    }).catch((err: unknown) => err);

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain(
      'The redeploy request for verifier "api-gateway" (dev) failed or returned an unexpected shape'
    );
    expect(message).toContain('deploymentRedeploy mutation failed');
    expect(message).toContain('nothing was redeployed on presenters');
    expect(message).toMatch(/re-running stage 2 is safe/i);
    expect(getLatestDeployment).not.toHaveBeenCalled();
  });

  it('omits non-Error rejection values when triggering the verifier redeploy rejects', async () => {
    const redeploy = vi
      .fn()
      .mockRejectedValue('raw trigger rejection carrying SENTINEL-TOKEN-VALUE');
    const getLatestDeployment = vi.fn();

    const caught = await redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'prod',
      redeploy,
      getLatestDeployment,
    }).catch((err: unknown) => err);

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain(
      'The redeploy request for verifier "api-gateway" (prod) failed or returned an unexpected shape (unknown error)'
    );
    expect(message).toContain('nothing was redeployed on presenters');
    expect(message).not.toContain('SENTINEL-TOKEN-VALUE');
    expect(getLatestDeployment).not.toHaveBeenCalled();
  });

  it('states that the verifier may already be restarting and names the verifier when triggering the redeploy fails', async () => {
    const redeploy = vi.fn().mockRejectedValue(new Error('unexpected shape'));
    const getLatestDeployment = vi.fn();

    const caught = await redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'dev',
      redeploy,
      getLatestDeployment,
    }).catch((err: unknown) => err);

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('api-gateway');
    expect(message).toContain('may already be restarting');
    expect(getLatestDeployment).not.toHaveBeenCalled();
  });

  it('explains that a NEEDS_APPROVAL deployment is awaiting approval in Railway rather than calling it a terminal status', async () => {
    const redeploy = vi
      .fn()
      .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' });
    const getLatestDeployment = vi
      .fn()
      .mockResolvedValue({ id: 'dep-new', status: 'NEEDS_APPROVAL' });
    const sleep = vi.fn().mockResolvedValue(undefined);
    let t = 0;

    const caught = await redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'prod',
      timeoutMs: 1000,
      redeploy,
      getLatestDeployment,
      sleep,
      now: () => (t += 500),
    }).catch((err: unknown) => err);

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toMatch(/awaiting approval/);
    expect(message).not.toMatch(/terminal status/i);
    expect(message).toContain('api-gateway');
    expect(message).toContain('prod');
    expect(message).toContain('nothing was redeployed on presenters');
    expect(getLatestDeployment).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('fails fast without sleeping when a third deployment id (neither the pre-redeploy id nor ours) becomes latest during the wait', async () => {
    const redeploy = vi
      .fn()
      .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' });
    const getLatestDeployment = vi
      .fn()
      .mockResolvedValue({ id: 'dep-superseding', status: 'BUILDING' });
    const sleep = vi.fn().mockResolvedValue(undefined);
    let t = 0;

    const caught = await redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'prod',
      timeoutMs: 1000,
      redeploy,
      getLatestDeployment,
      sleep,
      now: () => (t += 500),
    }).catch((err: unknown) => err);

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toMatch(/supersedes ours/);
    expect(message).toContain(
      'Stage 2 redeployed verifier "api-gateway" (prod), but a different deployment (dep-superseding, BUILDING) became the latest during the wait and supersedes ours'
    );
    expect(message).toContain('check it reached SUCCESS in Railway, then re-run stage 2');
    expect(message).toContain('nothing was redeployed on presenters');
    expect(getLatestDeployment).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('keeps waiting when polls return the pre-redeploy deployment id and resolves once the new deployment id reaches SUCCESS', async () => {
    const redeploy = vi
      .fn()
      .mockResolvedValue({ sourceDeploymentId: 'dep-prev', newDeploymentId: 'dep-new' });
    const getLatestDeployment = vi
      .fn()
      .mockResolvedValueOnce({ id: 'dep-prev', status: 'SUCCESS' })
      .mockResolvedValueOnce({ id: 'dep-prev', status: 'SUCCESS' })
      .mockResolvedValueOnce({ id: 'dep-new', status: 'SUCCESS' });

    const promise = redeployAndWaitForVerifier({
      environmentId: 'env-1',
      verifier: VERIFIER,
      env: 'dev',
      redeploy,
      getLatestDeployment,
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_VERIFIER_POLL_INTERVAL_MS * 2);
    await expect(promise).resolves.toBe('dep-new');
    expect(getLatestDeployment).toHaveBeenCalledTimes(3);
  });

  // Pins the documented soft-budget behavior: rejected polls do not check the deadline.
  it('overshoots the soft timeoutMs budget across rejected polls until a poll succeeds and checks the deadline', async () => {
    const redeploy = vi
      .fn()
      .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' });
    const getLatestDeployment = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient poll failure 1'))
      .mockRejectedValueOnce(new Error('transient poll failure 2'))
      .mockResolvedValueOnce({ id: 'dep-old', status: 'SUCCESS' });
    const sleep = vi.fn().mockResolvedValue(undefined);
    let nowReads = 0;

    await expect(
      redeployAndWaitForVerifier({
        environmentId: 'env-1',
        verifier: VERIFIER,
        env: 'dev',
        timeoutMs: 1000,
        redeploy,
        getLatestDeployment,
        sleep,
        now: () => (nowReads++ === 0 ? 0 : 5000),
      })
    ).rejects.toThrow(/Timed out/);

    expect(getLatestDeployment).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe('assertPresentersStillReady', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves when every presenter latest deployment has status SUCCESS', async () => {
    const getLatestDeployment = vi
      .fn()
      .mockResolvedValueOnce({ id: 'dep-bot', status: 'SUCCESS' })
      .mockResolvedValueOnce({ id: 'dep-ai', status: 'SUCCESS' });

    await expect(
      assertPresentersStillReady({
        environmentId: 'env-1',
        presenters: [
          { id: 'svc-bot', name: 'bot-client' },
          { id: 'svc-ai', name: 'ai-worker' },
        ],
        env: 'dev',
        getLatestDeployment,
      })
    ).resolves.toBeUndefined();

    expect(getLatestDeployment).toHaveBeenCalledTimes(2);
    expect(getLatestDeployment).toHaveBeenNthCalledWith(1, {
      environmentId: 'env-1',
      serviceId: 'svc-bot',
      env: 'dev',
    });
    expect(getLatestDeployment).toHaveBeenNthCalledWith(2, {
      environmentId: 'env-1',
      serviceId: 'svc-ai',
      env: 'dev',
    });
  });

  it('collects every non-ready presenter into a single Error when one is BUILDING and one has no latest deployment', async () => {
    const getLatestDeployment = vi
      .fn()
      .mockResolvedValueOnce({ id: 'dep-bot', status: 'BUILDING' })
      .mockResolvedValueOnce(null);

    const caught = await assertPresentersStillReady({
      environmentId: 'env-1',
      presenters: [
        { id: 'svc-bot', name: 'bot-client' },
        { id: 'svc-ai', name: 'ai-worker' },
      ],
      env: 'prod',
      getLatestDeployment,
    }).catch((err: unknown) => err);

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'Stage 2 restarted the verifier and it reached SUCCESS, but presenter(s) ' +
        'bot-client (BUILDING), ai-worker (missing) are no longer ready — no presenter was redeployed. ' +
        'Re-run stage 2 once they settle; it repeats the verifier redeploy and is safe ' +
        'while the dual-acceptance window is open.'
    );
    expect((caught as Error).message).not.toContain('Nothing was changed');
    expect(getLatestDeployment).toHaveBeenCalledTimes(2);
  });

  it('is a no-op and makes no deployment reads when the presenter list is empty', async () => {
    const getLatestDeployment = vi.fn();

    await expect(
      assertPresentersStillReady({
        environmentId: 'env-1',
        presenters: [],
        env: 'dev',
        getLatestDeployment,
      })
    ).resolves.toBeUndefined();

    expect(getLatestDeployment).not.toHaveBeenCalled();
  });

  it('wraps a getLatestDeployment rejection with the stage-2 recovery context', async () => {
    const readError = new Error('Railway API request timed out after 30s');
    const getLatestDeployment = vi.fn().mockRejectedValueOnce(readError);

    const caught = await assertPresentersStillReady({
      environmentId: 'env-1',
      presenters: [{ id: 'svc-bot', name: 'bot-client' }],
      env: 'dev',
      getLatestDeployment,
    }).catch((err: unknown) => err);

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBe(readError);
    const message = (caught as Error).message;
    expect(message).toBe(
      'Stage 2 restarted the verifier and it reached SUCCESS, but reading presenter ' +
        '"bot-client" failed (Railway API request timed out after 30s) — no presenter was redeployed. ' +
        'Re-run stage 2; it repeats the verifier redeploy and is safe while the dual-acceptance window is open.'
    );
    expect(message).toContain('bot-client');
    expect(message).toContain('Railway API request timed out after 30s');
    expect(message).toContain('verifier');
    expect(message).toContain('safe');
  });

  it('omits non-Error rejection values when reading a presenter deployment rejects', async () => {
    const getLatestDeployment = vi
      .fn()
      .mockRejectedValueOnce('raw presenter read rejection carrying SENTINEL-TOKEN-VALUE');

    const caught = await assertPresentersStillReady({
      environmentId: 'env-1',
      presenters: [{ id: 'svc-bot', name: 'bot-client' }],
      env: 'prod',
      getLatestDeployment,
    }).catch((err: unknown) => err);

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('reading presenter "bot-client" failed (unknown error)');
    expect(message).toContain('verifier');
    expect(message).toContain('safe');
    expect(message).not.toContain('SENTINEL-TOKEN-VALUE');
  });

  it('stops at the first failing presenter read without reading later presenters', async () => {
    const getLatestDeployment = vi.fn().mockRejectedValueOnce(new Error('bot-client read boom'));

    await expect(
      assertPresentersStillReady({
        environmentId: 'env-1',
        presenters: [
          { id: 'svc-bot', name: 'bot-client' },
          { id: 'svc-ai', name: 'ai-worker' },
        ],
        env: 'dev',
        getLatestDeployment,
      })
    ).rejects.toThrow('reading presenter "bot-client" failed (bot-client read boom)');

    expect(getLatestDeployment).toHaveBeenCalledTimes(1);
    expect(getLatestDeployment).toHaveBeenCalledWith({
      environmentId: 'env-1',
      serviceId: 'svc-bot',
      env: 'dev',
    });
  });
});
