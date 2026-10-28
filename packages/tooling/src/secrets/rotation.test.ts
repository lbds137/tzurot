/**
 * Tests for secret-rotation tooling. Real crypto (encryptWithKey fixtures),
 * mocked Railway CLI + Prisma persistence.
 */

import util from 'node:util';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encryptWithKey, parseEncryptionKeyMaterial } from '@tzurot/common-types/utils/encryption';
import { RailwayRedeployRefusedError } from '../deployment/railway-api.js';
import type { RailwayIds } from '../deployment/railway-status.js';
import { DEFAULT_SERVICE_POLL_INTERVAL_MS } from './service-redeploy-wait.js';

const mockExecFileSync = vi.fn();
vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

const mockPrisma = {
  secretRotation: { upsert: vi.fn(), findMany: vi.fn() },
  userApiKey: { findMany: vi.fn(), updateMany: vi.fn() },
  userCredential: { findMany: vi.fn(), updateMany: vi.fn() },
};
const mockDispose = vi.fn();
vi.mock('@tzurot/common-types/services/prisma', () => ({
  createPrismaClient: () => ({ prisma: mockPrisma, dispose: mockDispose }),
}));

vi.mock('../utils/env-runner.js', () => ({
  getRailwayDatabaseUrl: vi.fn(() => 'postgresql://mock/db'),
  getRailwayEnvName: (env: string) => (env === 'prod' ? 'production' : 'development'),
}));

const {
  assertRailwayServiceDeploymentReady,
  requireRailwayApiToken,
  upsertRailwayVariable,
  deleteRailwayVariable,
  redeployRailwayServiceReusingImage,
  redeployRailwayServiceReusingImageWithSource,
  getRailwayServiceLatestDeployment,
  resolveRailwayIds,
} = vi.hoisted(() => ({
  assertRailwayServiceDeploymentReady: vi.fn(),
  requireRailwayApiToken: vi.fn(),
  upsertRailwayVariable: vi.fn(),
  deleteRailwayVariable: vi.fn(),
  redeployRailwayServiceReusingImage: vi.fn(),
  redeployRailwayServiceReusingImageWithSource: vi.fn(),
  getRailwayServiceLatestDeployment: vi.fn(),
  resolveRailwayIds: vi.fn((_env: string, service: string): RailwayIds => ({
    projectId: 'proj',
    environmentId: 'envid',
    serviceId: 'svc-' + service,
  })),
}));

vi.mock('../deployment/railway-api.js', () => ({
  assertRailwayServiceDeploymentReady,
  requireRailwayApiToken,
  upsertRailwayVariable,
  deleteRailwayVariable,
  redeployRailwayServiceReusingImage,
  redeployRailwayServiceReusingImageWithSource,
  getRailwayServiceLatestDeployment,
  // redeploy-repair-text.ts does `instanceof` against this class on a failure's error.
  RailwayRedeployRefusedError: class RailwayRedeployRefusedError extends Error {
    name = 'RailwayRedeployRefusedError';
  },
}));

vi.mock('../deployment/railway-status.js', () => ({
  resolveRailwayIds,
}));

import {
  markSecretRotated,
  rotateByokKey,
  getServiceVariable,
  showRotationStatus,
  warnIfCapped,
  DEFAULT_INTERVALS,
} from './rotation.js';

const KEY_A_HEX = 'a'.repeat(64);
const KEY_B_HEX = 'b'.repeat(64);
const KEY_A = parseEncryptionKeyMaterial(KEY_A_HEX, 'TEST');
const KEY_B = parseEncryptionKeyMaterial(KEY_B_HEX, 'TEST');

/** Per-service railway `variables --json` stub — for split-brain scenarios. */
function stubRailwayVarsPerService(byService: Record<string, Record<string, string>>): void {
  mockExecFileSync.mockImplementation((_cmd: unknown, args: unknown) => {
    if (Array.isArray(args) && args.includes('--json')) {
      const service = String(args[args.indexOf('--service') + 1]);
      return JSON.stringify(byService[service] ?? {});
    }
    return '';
  });
}

/** Mock the railway `variables --json` read (same vars for every service). */
function stubRailwayVars(vars: Record<string, string>): void {
  mockExecFileSync.mockImplementation((_cmd: unknown, args: unknown) => {
    if (Array.isArray(args) && args.includes('--json')) {
      return JSON.stringify(vars);
    }
    return '';
  });
}

describe('markSecretRotated', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates with the owner-decided default intervals (180d BYOK, 365d rest)', async () => {
    await markSecretRotated({ env: 'dev', name: 'byok-encryption-key' });
    expect(mockPrisma.secretRotation.upsert).toHaveBeenCalledWith({
      where: { name: 'byok-encryption-key' },
      create: expect.objectContaining({ intervalDays: 180 }),
      // Un-flagged rotation: the update branch must NOT carry intervalDays,
      // or every routine finalize would reset a customized interval.
      update: { rotatedAt: expect.any(Date) },
    });

    await markSecretRotated({ env: 'dev', name: 'internal-service-secret' });
    expect(mockPrisma.secretRotation.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ intervalDays: 365 }) })
    );
    expect(DEFAULT_INTERVALS['byok-encryption-key']).toBe(180);
  });

  it('writes intervalDays on update ONLY when explicitly provided (customization survives)', async () => {
    await markSecretRotated({ env: 'dev', name: 'byok-encryption-key', intervalDays: 90 });
    expect(mockPrisma.secretRotation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { rotatedAt: expect.any(Date), intervalDays: 90 },
      })
    );
  });

  it('always disposes the client, even when the upsert throws', async () => {
    mockPrisma.secretRotation.upsert.mockRejectedValueOnce(new Error('db down'));
    await expect(markSecretRotated({ env: 'dev', name: 'byok-encryption-key' })).rejects.toThrow(
      'db down'
    );
    expect(mockDispose).toHaveBeenCalled();
  });
});

describe('getServiceVariable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when the variable is absent (never returns undefined silently)', () => {
    stubRailwayVars({ OTHER: 'x' });
    expect(() => getServiceVariable('dev', 'api-gateway', 'MISSING')).toThrow('MISSING');
  });
});

describe('rotateByokKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertRailwayServiceDeploymentReady.mockResolvedValue(undefined);
    requireRailwayApiToken.mockReturnValue('test-token');
    upsertRailwayVariable.mockResolvedValue(undefined);
    deleteRailwayVariable.mockResolvedValue(undefined);
    redeployRailwayServiceReusingImage.mockResolvedValue('dep-new');
    // Stage 2's per-service wait: each redeploy yields a new id that the next
    // latest-deployment poll reports at SUCCESS.
    redeployRailwayServiceReusingImageWithSource.mockImplementation(
      ({ serviceId }: { serviceId: string }) =>
        Promise.resolve({
          sourceDeploymentId: `old-${serviceId}`,
          newDeploymentId: `new-${serviceId}`,
        })
    );
    getRailwayServiceLatestDeployment.mockImplementation(({ serviceId }: { serviceId: string }) =>
      Promise.resolve({ id: `new-${serviceId}`, status: 'SUCCESS' })
    );
    resolveRailwayIds.mockImplementation((_env: string, service: string) => ({
      projectId: 'proj',
      environmentId: 'envid',
      serviceId: 'svc-' + service,
    }));
  });

  it('every stage refuses on split-brain key vars between the two services', async () => {
    // The partial-failure detector: api-gateway's write landed, ai-worker's
    // didn't — the tool must refuse rather than operate on gateway's view.
    stubRailwayVarsPerService({
      'api-gateway': { API_KEY_ENCRYPTION_KEY: KEY_A_HEX },
      'ai-worker': { API_KEY_ENCRYPTION_KEY: KEY_B_HEX },
    });

    for (const stage of ['1', '2', '3']) {
      await expect(rotateByokKey({ env: 'dev', stage })).rejects.toThrow('DIFFERS');
    }
    // And no variable writes may have happened from any refused stage.
    const setCalls = mockExecFileSync.mock.calls.filter(
      call => Array.isArray(call[1]) && (call[1] as string[]).includes('--set')
    );
    expect(setCalls).toHaveLength(0);
    expect(upsertRailwayVariable).not.toHaveBeenCalled();
    expect(deleteRailwayVariable).not.toHaveBeenCalled();
    expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
  });

  it('rejects an unknown stage before touching any Railway state', async () => {
    await expect(rotateByokKey({ env: 'dev', stage: 'yolo' })).rejects.toThrow('Unknown stage');
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('stage 2 refuses when no rotation window is open (PREVIOUS empty)', async () => {
    stubRailwayVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX, API_KEY_ENCRYPTION_KEY_PREVIOUS: '' });
    await expect(rotateByokKey({ env: 'dev', stage: '2' })).rejects.toThrow('stage 1 first');
    expect(redeployRailwayServiceReusingImageWithSource).not.toHaveBeenCalled();
  });

  it('stage 2 re-encrypts previous-key rows to the current key and leaves current rows alone', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
    });
    const oldRow = { id: 'row-old', ...encryptWithKey('sk-secret', KEY_B) };
    const currentRow = { id: 'row-new', ...encryptWithKey('sk-other', KEY_A) };
    // reencrypt pass reads, then the verify sweep reads again (post-update state)
    mockPrisma.userApiKey.findMany
      .mockResolvedValueOnce([oldRow, currentRow])
      .mockResolvedValueOnce([currentRow]);
    mockPrisma.userCredential.findMany.mockResolvedValue([]);
    mockPrisma.userApiKey.updateMany.mockResolvedValue({ count: 1 });

    await rotateByokKey({ env: 'dev', stage: '2' });

    expect(mockPrisma.userApiKey.updateMany).toHaveBeenCalledTimes(1);
    const call = mockPrisma.userApiKey.updateMany.mock.calls[0][0] as {
      where: { id: string; iv: string; content: string; tag: string };
      data: { iv: string; content: string; tag: string };
    };
    // Optimistic-concurrency guard: the WHERE pins the FULL snapshot
    // ciphertext, so a row changed between snapshot and write can't match.
    expect(call.where).toEqual({
      id: 'row-old',
      iv: oldRow.iv,
      content: oldRow.content,
      tag: oldRow.tag,
    });
    // The written row must decrypt under the CURRENT key — assert by decrypting.
    const { decryptWithKey } = await import('@tzurot/common-types/utils/encryption');
    expect(decryptWithKey(call.data, KEY_A)).toBe('sk-secret');
  });

  it('stage 1 happy path: PREVIOUS has NEVER existed on Railway (first rotation ever)', async () => {
    // Regression pin: the variable is absent from `railway variables --json`
    // entirely before the first rotation — absent must read as unset, not
    // throw — the window guard must treat a missing key as "no previous key"
    // rather than dereferencing it.
    stubRailwayVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await expect(rotateByokKey({ env: 'dev', stage: '1' })).resolves.toBeUndefined();

      const setCalls = mockExecFileSync.mock.calls.filter(
        call => Array.isArray(call[1]) && (call[1] as string[]).includes('--set')
      );
      expect(setCalls).toHaveLength(0);

      expect(upsertRailwayVariable).toHaveBeenCalledTimes(4);
      for (const serviceId of ['svc-api-gateway', 'svc-ai-worker']) {
        expect(upsertRailwayVariable).toHaveBeenCalledWith({
          projectId: 'proj',
          environmentId: 'envid',
          serviceId,
          name: 'API_KEY_ENCRYPTION_KEY_PREVIOUS',
          value: KEY_A_HEX,
          skipDeploys: true,
          env: 'dev',
        });
        expect(upsertRailwayVariable).toHaveBeenCalledWith({
          projectId: 'proj',
          environmentId: 'envid',
          serviceId,
          name: 'API_KEY_ENCRYPTION_KEY',
          value: expect.stringMatching(/^[0-9a-f]{64}$/),
          skipDeploys: true,
          env: 'dev',
        });
      }

      const currentCalls = upsertRailwayVariable.mock.calls
        .map(call => call[0] as { name: string; value: string })
        .filter(arg => arg.name === 'API_KEY_ENCRYPTION_KEY');
      expect(currentCalls).toHaveLength(2);
      expect(currentCalls[0].value).toMatch(/^[0-9a-f]{64}$/);
      expect(currentCalls[0].value).not.toBe(KEY_A_HEX);
      expect(currentCalls[1].value).toBe(currentCalls[0].value);

      expect(redeployRailwayServiceReusingImage).toHaveBeenCalledTimes(2);
      expect(redeployRailwayServiceReusingImage).toHaveBeenCalledWith({
        projectId: 'proj',
        environmentId: 'envid',
        serviceId: 'svc-api-gateway',
        serviceName: 'api-gateway',
        env: 'dev',
      });
      expect(redeployRailwayServiceReusingImage).toHaveBeenCalledWith({
        projectId: 'proj',
        environmentId: 'envid',
        serviceId: 'svc-ai-worker',
        serviceName: 'ai-worker',
        env: 'dev',
      });

      const previousOrders = upsertRailwayVariable.mock.calls
        .map((call, idx) => ({
          name: (call[0] as { name: string }).name,
          order: upsertRailwayVariable.mock.invocationCallOrder[idx],
        }))
        .filter(entry => entry.name === 'API_KEY_ENCRYPTION_KEY_PREVIOUS')
        .map(entry => entry.order);
      const currentOrders = upsertRailwayVariable.mock.calls
        .map((call, idx) => ({
          name: (call[0] as { name: string }).name,
          order: upsertRailwayVariable.mock.invocationCallOrder[idx],
        }))
        .filter(entry => entry.name === 'API_KEY_ENCRYPTION_KEY')
        .map(entry => entry.order);
      expect(previousOrders).toHaveLength(2);
      expect(currentOrders).toHaveLength(2);
      expect(Math.max(...previousOrders)).toBeLessThan(Math.min(...currentOrders));

      const lastUpsertOrder = Math.max(...upsertRailwayVariable.mock.invocationCallOrder);
      const firstRedeployOrder = Math.min(
        ...redeployRailwayServiceReusingImage.mock.invocationCallOrder
      );
      expect(lastUpsertOrder).toBeLessThan(firstRedeployOrder);

      const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
      expect(allOutput).not.toMatch(/[0-9a-f]{64}/);
      expect(allOutput).toContain('  set API_KEY_ENCRYPTION_KEY_PREVIOUS on api-gateway (dev)');
      expect(allOutput).toContain('  set API_KEY_ENCRYPTION_KEY_PREVIOUS on ai-worker (dev)');
      expect(allOutput).toContain('  set API_KEY_ENCRYPTION_KEY on api-gateway (dev)');
      expect(allOutput).toContain('  set API_KEY_ENCRYPTION_KEY on ai-worker (dev)');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('stage 1 failure state 1 (1st upsert fails — PREVIOUS on first service): honest may-or-may-not-have-applied message, re-run stage 1', async () => {
    stubRailwayVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX });
    upsertRailwayVariable.mockRejectedValueOnce(new Error('upsert boom'));

    let caught: unknown;
    try {
      await rotateByokKey({ env: 'dev', stage: '1' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = caught instanceof Error ? caught.message : '';
    expect(message).toBe(
      'Failed to upsert API_KEY_ENCRYPTION_KEY_PREVIOUS on api-gateway (dev); it may or may not have applied. Re-run stage 1. No stored row has been touched; stage 2 has not run.'
    );
    expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
  });

  it('stage 1 failure state 2 (2nd upsert fails — PREVIOUS on second service): honest may-or-may-not-have-applied message, re-run stage 1', async () => {
    stubRailwayVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX });
    upsertRailwayVariable
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('upsert boom'));

    let caught: unknown;
    try {
      await rotateByokKey({ env: 'dev', stage: '1' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = caught instanceof Error ? caught.message : '';
    expect(message).toBe(
      'Failed to upsert API_KEY_ENCRYPTION_KEY_PREVIOUS on ai-worker (dev); it may or may not have applied. Re-run stage 1. No stored row has been touched; stage 2 has not run.'
    );
    expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
  });

  it('stage 1 failure state 3 (3rd upsert fails — CURRENT on first service): re-run stage 1 and follow what it reports, with deploy:redeploy commands', async () => {
    stubRailwayVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX });
    upsertRailwayVariable
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('upsert boom'));

    let caught: unknown;
    try {
      await rotateByokKey({ env: 'dev', stage: '1' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = caught instanceof Error ? caught.message : '';
    expect(message).toBe(
      'Failed to upsert API_KEY_ENCRYPTION_KEY on api-gateway (dev); it may or may not have applied. Re-run stage 1, then follow what it reports: if it completes, nothing more to do; if it reports API_KEY_ENCRYPTION_KEY DIFFERS, copy API_KEY_ENCRYPTION_KEY from api-gateway to ai-worker in the Railway dashboard, then run stage 2, which redeploys both services itself and waits for each to reach SUCCESS; if it reports a rotation window is already open, every write landed: run stage 2, which redeploys both services itself. No stored row has been touched; stage 2 has not run.'
    );
    expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
  });

  it('stage 1 failure state 4 (4th upsert fails — CURRENT on second service): re-run stage 1 and follow what it reports, with deploy:redeploy commands', async () => {
    stubRailwayVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX });
    upsertRailwayVariable
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('upsert boom'));

    let caught: unknown;
    try {
      await rotateByokKey({ env: 'dev', stage: '1' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = caught instanceof Error ? caught.message : '';
    expect(message).toBe(
      'Failed to upsert API_KEY_ENCRYPTION_KEY on ai-worker (dev); it may or may not have applied. Re-run stage 1, then follow what it reports: if it completes, nothing more to do; if it reports API_KEY_ENCRYPTION_KEY DIFFERS, copy API_KEY_ENCRYPTION_KEY from api-gateway to ai-worker in the Railway dashboard, then run stage 2, which redeploys both services itself and waits for each to reach SUCCESS; if it reports a rotation window is already open, every write landed: run stage 2, which redeploys both services itself. No stored row has been touched; stage 2 has not run.'
    );
    expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
  });

  it('stage 1 never leaks old or new key material in util.inspect(caught) or console.log when an upsert rejects with the old key', async () => {
    stubRailwayVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    upsertRailwayVariable
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error(`upsert failed with key ${KEY_A_HEX}`));

    let caught: unknown;
    try {
      await rotateByokKey({ env: 'dev', stage: '1' });
    } catch (error) {
      caught = error;
    } finally {
      const newKeyHex = (upsertRailwayVariable.mock.calls[2][0] as { value: string }).value;
      expect(newKeyHex).toMatch(/^[0-9a-f]{64}$/);
      expect(newKeyHex).not.toBe(KEY_A_HEX);

      expect(caught).toBeInstanceOf(Error);
      const inspected = util.inspect(caught, { depth: null });
      expect(inspected).not.toContain(KEY_A_HEX);
      expect(inspected).not.toContain(newKeyHex);
      expect(inspected).not.toMatch(/[0-9a-f]{64}/);

      for (const call of logSpy.mock.calls) {
        for (const arg of call) {
          const rendered = String(arg);
          expect(rendered).not.toContain(KEY_A_HEX);
          expect(rendered).not.toContain(newKeyHex);
          expect(rendered).not.toMatch(/[0-9a-f]{64}/);
        }
      }
      logSpy.mockRestore();
    }
  });

  it('stage 1 attempts both redeploys and throws when one service fails to redeploy', async () => {
    stubRailwayVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX });
    redeployRailwayServiceReusingImage.mockImplementation(({ serviceId }: { serviceId: string }) =>
      serviceId === 'svc-api-gateway'
        ? Promise.reject(new Error('redeploy boom'))
        : Promise.resolve('dep-new')
    );

    const promise = rotateByokKey({ env: 'dev', stage: '1' });
    await expect(promise).rejects.toThrow(
      "Run stage 2 once both services' latest deployments have settled: it redeploys both services itself and waits for each new deployment to reach SUCCESS before touching any row. If a service's latest deployment is FAILED, CRASHED, REMOVED or SKIPPED, fix it in the Railway dashboard until its latest deployment is SUCCESS first, because stage 2's readiness check refuses it (`pnpm ops deploy:redeploy` refuses it too)."
    );
    await expect(promise).rejects.not.toThrow('not verified:');
    expect(redeployRailwayServiceReusingImage).toHaveBeenCalledTimes(2);
  });

  it('stage 1 proceeds when PREVIOUS equals CURRENT on both services (degenerate window)', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_A_HEX,
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await expect(rotateByokKey({ env: 'dev', stage: '1' })).resolves.toBeUndefined();
      expect(upsertRailwayVariable).toHaveBeenCalledTimes(4);
      expect(redeployRailwayServiceReusingImage).toHaveBeenCalledTimes(2);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('stage 1 refuses while a rotation window is already open (would orphan unmigrated rows)', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
    });

    const promise = rotateByokKey({ env: 'dev', stage: '1' });
    await expect(promise).rejects.toThrow(
      'A rotation window is already open (PREVIOUS is set) — run stage 2 then stage 3 to close it before starting a new rotation.'
    );
    await expect(promise).rejects.toThrow(
      "If stage 1 itself was interrupted after its writes, run stage 2 once both services' latest deployments have settled: it redeploys both services itself and waits for each to reach SUCCESS. If a service's latest deployment is FAILED, CRASHED, REMOVED or SKIPPED, fix it in the Railway dashboard until its latest deployment is SUCCESS first, because stage 2's readiness check refuses it (`pnpm ops deploy:redeploy` refuses it too)."
    );
    // No variable writes or redeploys may have happened.
    const setCalls = mockExecFileSync.mock.calls.filter(
      call => Array.isArray(call[1]) && (call[1] as string[]).includes('--set')
    );
    expect(setCalls).toHaveLength(0);
    expect(upsertRailwayVariable).not.toHaveBeenCalled();
    expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
  });

  describe('stage 2 through the real redeploy wait (only the Railway API mocked)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('stage 2 skips (never overwrites) a row that changed between snapshot and write', async () => {
      stubRailwayVars({
        API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
        API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
      });
      const oldRow = { id: 'row-old', ...encryptWithKey('sk-secret', KEY_B) };
      mockPrisma.userApiKey.findMany.mockResolvedValueOnce([oldRow]).mockResolvedValueOnce([]);
      mockPrisma.userCredential.findMany.mockResolvedValue([]);
      // count 0 = the guarded write found no matching snapshot ciphertext.
      mockPrisma.userApiKey.updateMany.mockResolvedValue({ count: 0 });

      await expect(rotateByokKey({ env: 'dev', stage: '2' })).resolves.toBeUndefined();
      expect(mockPrisma.userApiKey.updateMany).toHaveBeenCalledTimes(1);
    });

    it('stage 2 warns to triage a row that matches neither key, leaves it untouched, and tallies it unreadable', async () => {
      stubRailwayVars({
        API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
        API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
      });
      const strangerKey = parseEncryptionKeyMaterial('c'.repeat(64), 'TEST');
      const strangerRow = { id: 'row-stranger', ...encryptWithKey('sk-stranger', strangerKey) };
      mockPrisma.userApiKey.findMany
        .mockResolvedValueOnce([strangerRow])
        .mockResolvedValueOnce([strangerRow]);
      mockPrisma.userCredential.findMany.mockResolvedValue([]);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        await expect(rotateByokKey({ env: 'dev', stage: '2' })).resolves.toBeUndefined();
        const lines = logSpy.mock.calls.map(call => util.stripVTControlCharacters(String(call[0])));
        expect(lines).toContain(
          '  userApiKey: 0 re-encrypted, 0 already current, 0 changed concurrently (skipped), 1 unreadable'
        );
        expect(lines).toContain('  ⚠️  1 row(s) match neither key — triage before finalizing.');
      } finally {
        logSpy.mockRestore();
      }
      expect(mockPrisma.userApiKey.updateMany).not.toHaveBeenCalled();
    });

    it('stage 2 reports a row still off the current key after the sweep instead of the verified line', async () => {
      stubRailwayVars({
        API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
        API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
      });
      const oldRow = { id: 'row-old', ...encryptWithKey('sk-secret', KEY_B) };
      // The guarded write matches nothing (count 0), and the verify read still
      // sees the row on the previous key.
      mockPrisma.userApiKey.findMany
        .mockResolvedValueOnce([oldRow])
        .mockResolvedValueOnce([oldRow]);
      mockPrisma.userCredential.findMany.mockResolvedValue([]);
      mockPrisma.userApiKey.updateMany.mockResolvedValue({ count: 0 });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        await expect(rotateByokKey({ env: 'dev', stage: '2' })).resolves.toBeUndefined();
        const lines = logSpy.mock.calls.map(call => util.stripVTControlCharacters(String(call[0])));
        expect(lines.some(line => line.includes('1 row(s) still not on the current key.'))).toBe(
          true
        );
        expect(lines.some(line => line.includes('All rows verified on the current key'))).toBe(
          false
        );
      } finally {
        logSpy.mockRestore();
      }
    });

    it('stage 2 redeploys api-gateway then ai-worker (real chain, mocked Railway API) before any row is written', async () => {
      stubRailwayVars({
        API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
        API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
      });
      const oldRow = { id: 'row-old', ...encryptWithKey('sk-secret', KEY_B) };
      mockPrisma.userApiKey.findMany.mockResolvedValueOnce([oldRow]).mockResolvedValueOnce([]);
      mockPrisma.userCredential.findMany.mockResolvedValue([]);
      mockPrisma.userApiKey.updateMany.mockResolvedValue({ count: 1 });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        await rotateByokKey({ env: 'dev', stage: '2' });
      } finally {
        logSpy.mockRestore();
      }

      expect(redeployRailwayServiceReusingImageWithSource.mock.calls.map(c => c[0])).toEqual([
        {
          environmentId: 'envid',
          serviceId: 'svc-api-gateway',
          serviceName: 'api-gateway',
          env: 'dev',
        },
        {
          environmentId: 'envid',
          serviceId: 'svc-ai-worker',
          serviceName: 'ai-worker',
          env: 'dev',
        },
      ]);
      const [gatewayRedeployOrder, workerRedeployOrder] =
        redeployRailwayServiceReusingImageWithSource.mock.invocationCallOrder;
      expect(gatewayRedeployOrder).toBeLessThan(workerRedeployOrder);
      expect(workerRedeployOrder).toBeLessThan(
        mockPrisma.userApiKey.updateMany.mock.invocationCallOrder[0]
      );
      // Stage 2 calls the `WithSource` variant directly (it needs the source deployment
      // id), not the thin wrapper that stage 1 uses.
      expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
    });

    it('stage 2 refuses, writing no row, when only ai-worker CURRENT changes during the waits', async () => {
      const window = {
        API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
        API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
      };
      const byService = { 'api-gateway': { ...window }, 'ai-worker': { ...window } };
      stubRailwayVarsPerService(byService);
      // The stub reads byService on every call, so editing it inside the ai-worker
      // redeploy is a concurrent edit that lands between the first read and the re-read.
      redeployRailwayServiceReusingImageWithSource.mockImplementation(
        ({ serviceId }: { serviceId: string }) => {
          if (serviceId === 'svc-ai-worker') {
            byService['ai-worker'].API_KEY_ENCRYPTION_KEY = 'c'.repeat(64);
          }
          return Promise.resolve({
            sourceDeploymentId: `old-${serviceId}`,
            newDeploymentId: `new-${serviceId}`,
          });
        }
      );
      mockPrisma.userApiKey.findMany.mockResolvedValue([]);
      mockPrisma.userCredential.findMany.mockResolvedValue([]);

      await expect(rotateByokKey({ env: 'dev', stage: '2' })).rejects.toThrow('DIFFERS');

      expect(redeployRailwayServiceReusingImageWithSource).toHaveBeenCalledTimes(2);
      expect(mockPrisma.userApiKey.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.userCredential.updateMany).not.toHaveBeenCalled();
    });

    it('stage 2 sleeps through a DEPLOYING poll on the gateway and writes a row only after both waits settle', async () => {
      stubRailwayVars({
        API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
        API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
      });
      const oldRow = { id: 'row-old', ...encryptWithKey('sk-secret', KEY_B) };
      mockPrisma.userApiKey.findMany.mockResolvedValueOnce([oldRow]).mockResolvedValueOnce([]);
      mockPrisma.userCredential.findMany.mockResolvedValue([]);
      mockPrisma.userApiKey.updateMany.mockResolvedValue({ count: 1 });
      getRailwayServiceLatestDeployment
        .mockResolvedValueOnce({ id: 'new-svc-api-gateway', status: 'DEPLOYING' })
        .mockImplementation(({ serviceId }: { serviceId: string }) =>
          Promise.resolve({ id: `new-${serviceId}`, status: 'SUCCESS' })
        );
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        const promise = rotateByokKey({ env: 'dev', stage: '2' });
        await vi.advanceTimersByTimeAsync(DEFAULT_SERVICE_POLL_INTERVAL_MS);
        await promise;
      } finally {
        logSpy.mockRestore();
      }

      expect(getRailwayServiceLatestDeployment).toHaveBeenCalledTimes(3);
      expect(getRailwayServiceLatestDeployment.mock.calls.map(c => c[0].serviceId)).toEqual([
        'svc-api-gateway',
        'svc-api-gateway',
        'svc-ai-worker',
      ]);
      const [, workerRedeployOrder] =
        redeployRailwayServiceReusingImageWithSource.mock.invocationCallOrder;
      const gatewaySettledOrder = getRailwayServiceLatestDeployment.mock.invocationCallOrder[1];
      const workerSettledOrder = getRailwayServiceLatestDeployment.mock.invocationCallOrder[2];
      expect(gatewaySettledOrder).toBeLessThan(workerRedeployOrder);
      expect(workerSettledOrder).toBeLessThan(
        mockPrisma.userApiKey.updateMany.mock.invocationCallOrder[0]
      );
    });

    it('stage 2 touches no row when a service redeploy never reaches SUCCESS', async () => {
      stubRailwayVars({
        API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
        API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
      });
      const oldRow = { id: 'row-old', ...encryptWithKey('sk-secret', KEY_B) };
      mockPrisma.userApiKey.findMany.mockResolvedValue([oldRow]);
      getRailwayServiceLatestDeployment.mockImplementation(({ serviceId }: { serviceId: string }) =>
        Promise.resolve({
          id: `new-${serviceId}`,
          status: serviceId === 'svc-ai-worker' ? 'FAILED' : 'SUCCESS',
        })
      );
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        await expect(rotateByokKey({ env: 'dev', stage: '2' })).rejects.toThrow(
          'BYOK stage 2 redeployed service "ai-worker" (dev), but the new deployment reached terminal status FAILED'
        );
      } finally {
        logSpy.mockRestore();
      }
      expect(mockPrisma.userApiKey.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.userApiKey.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.userCredential.updateMany).not.toHaveBeenCalled();
    });
  });

  it('stage 3 refuses to close the window while any row is off the current key', async () => {
    stubRailwayVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX });
    const strayRow = { id: 'stray', ...encryptWithKey('sk-x', KEY_B) };
    mockPrisma.userApiKey.findMany.mockResolvedValue([strayRow]);
    mockPrisma.userCredential.findMany.mockResolvedValue([]);

    await expect(rotateByokKey({ env: 'dev', stage: '3' })).rejects.toThrow('re-run stage 2');
    // The window must NOT have been closed nor the ledger stamped.
    expect(deleteRailwayVariable).not.toHaveBeenCalled();
    expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
    expect(mockPrisma.secretRotation.upsert).not.toHaveBeenCalled();
  });

  it('stage 3 deletes PREVIOUS on both services via the API, redeploys both, then stamps the ledger', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
    });
    mockPrisma.userApiKey.findMany.mockResolvedValue([]);
    mockPrisma.userCredential.findMany.mockResolvedValue([]);
    mockPrisma.secretRotation.upsert.mockResolvedValue({});

    await rotateByokKey({ env: 'dev', stage: 'finalize' });

    expect(deleteRailwayVariable).toHaveBeenCalledTimes(2);
    expect(deleteRailwayVariable).toHaveBeenCalledWith({
      projectId: 'proj',
      environmentId: 'envid',
      serviceId: 'svc-api-gateway',
      name: 'API_KEY_ENCRYPTION_KEY_PREVIOUS',
      env: 'dev',
    });
    expect(deleteRailwayVariable).toHaveBeenCalledWith({
      projectId: 'proj',
      environmentId: 'envid',
      serviceId: 'svc-ai-worker',
      name: 'API_KEY_ENCRYPTION_KEY_PREVIOUS',
      env: 'dev',
    });
    expect(redeployRailwayServiceReusingImage).toHaveBeenCalledTimes(2);
    expect(redeployRailwayServiceReusingImage).toHaveBeenCalledWith({
      projectId: 'proj',
      environmentId: 'envid',
      serviceId: 'svc-api-gateway',
      serviceName: 'api-gateway',
      env: 'dev',
    });
    expect(redeployRailwayServiceReusingImage).toHaveBeenCalledWith({
      projectId: 'proj',
      environmentId: 'envid',
      serviceId: 'svc-ai-worker',
      serviceName: 'ai-worker',
      env: 'dev',
    });
    const setCalls = mockExecFileSync.mock.calls.filter(
      call => Array.isArray(call[1]) && (call[1] as string[]).includes('--set')
    );
    expect(setCalls).toHaveLength(0);
    expect(mockPrisma.secretRotation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'byok-encryption-key' } })
    );
    const lastDeleteOrder = Math.max(...deleteRailwayVariable.mock.invocationCallOrder);
    const firstRedeployOrder = Math.min(
      ...redeployRailwayServiceReusingImage.mock.invocationCallOrder
    );
    expect(lastDeleteOrder).toBeLessThan(firstRedeployOrder);
    const lastRedeployOrder = Math.max(
      ...redeployRailwayServiceReusingImage.mock.invocationCallOrder
    );
    const upsertOrder = mockPrisma.secretRotation.upsert.mock.invocationCallOrder[0];
    expect(upsertOrder).toBeGreaterThan(lastRedeployOrder);
  });

  it('stage 3 skips the delete when PREVIOUS is already absent but still redeploys and stamps', async () => {
    stubRailwayVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX });
    mockPrisma.userApiKey.findMany.mockResolvedValue([]);
    mockPrisma.userCredential.findMany.mockResolvedValue([]);
    mockPrisma.secretRotation.upsert.mockResolvedValue({});

    await rotateByokKey({ env: 'dev', stage: '3' });

    expect(deleteRailwayVariable).not.toHaveBeenCalled();
    expect(redeployRailwayServiceReusingImage).toHaveBeenCalledTimes(2);
    expect(mockPrisma.secretRotation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'byok-encryption-key' } })
    );
  });

  it('stage 3 still deletes PREVIOUS when it is present as an empty string on both services', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: '',
    });
    mockPrisma.userApiKey.findMany.mockResolvedValue([]);
    mockPrisma.userCredential.findMany.mockResolvedValue([]);
    mockPrisma.secretRotation.upsert.mockResolvedValue({});

    await rotateByokKey({ env: 'dev', stage: '3' });

    expect(deleteRailwayVariable).toHaveBeenCalledTimes(2);
    expect(mockPrisma.secretRotation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'byok-encryption-key' } })
    );
  });

  it('stage 3 does not stamp the ledger when a redeploy fails, and its repair names the redeploy + mark-rotated commands', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
    });
    mockPrisma.userApiKey.findMany.mockResolvedValue([]);
    mockPrisma.userCredential.findMany.mockResolvedValue([]);
    redeployRailwayServiceReusingImage.mockImplementation(({ serviceId }: { serviceId: string }) =>
      serviceId === 'svc-ai-worker'
        ? Promise.reject(new Error('redeploy boom'))
        : Promise.resolve('dep-new')
    );

    const promise = rotateByokKey({ env: 'dev', stage: '3' });
    await expect(promise).rejects.toThrow('ai-worker');
    await expect(promise).rejects.toThrow(
      '`pnpm ops deploy:redeploy --env dev --service ai-worker --yes`'
    );
    await expect(promise).rejects.toThrow(
      '`pnpm ops secrets:mark-rotated byok-encryption-key --env dev`'
    );
    // A re-run would hit the stage-3 readiness preflight while a redeploy is
    // still settling — the message must not send the operator back to stage 3.
    await expect(promise).rejects.not.toThrow('re-run stage 3');
    await expect(promise).rejects.not.toThrow('api-gateway');
    expect(redeployRailwayServiceReusingImage).toHaveBeenCalledTimes(2);
    expect(mockPrisma.secretRotation.upsert).not.toHaveBeenCalled();
  });

  it('stage 3 sends a REFUSED redeploy to the dashboard first and keeps the command only as the retry', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
    });
    mockPrisma.userApiKey.findMany.mockResolvedValue([]);
    mockPrisma.userCredential.findMany.mockResolvedValue([]);
    redeployRailwayServiceReusingImage.mockImplementation(({ serviceId }: { serviceId: string }) =>
      serviceId === 'svc-ai-worker'
        ? Promise.reject(
            new RailwayRedeployRefusedError("ai-worker's latest deployment is BUILDING")
          )
        : Promise.resolve('dep-new')
    );

    const error = await rotateByokKey({ env: 'dev', stage: '3' }).then(
      () => new Error('expected a rejection'),
      (e: unknown) => e as Error
    );

    expect(error.message).toContain(
      'ai-worker: the redeploy was refused because the latest deployment is not SUCCESS — wait for it to settle, or fix it in the Railway dashboard, then redeploy it with `pnpm ops deploy:redeploy --env dev --service ai-worker --yes`, then stamp the ledger'
    );
    // The command is never the first repair for the refused service.
    expect(error.message).not.toContain('Redeploy ai-worker with');
    expect(error.message).not.toContain('api-gateway');
    expect(mockPrisma.secretRotation.upsert).not.toHaveBeenCalled();
  });

  it('the CURRENT-differs guard error ends at its own repair and carries no stage-3 var-delete hint', async () => {
    stubRailwayVarsPerService({
      'api-gateway': { API_KEY_ENCRYPTION_KEY: KEY_A_HEX },
      'ai-worker': { API_KEY_ENCRYPTION_KEY: KEY_B_HEX },
    });

    const promise = rotateByokKey({ env: 'dev', stage: '3' });
    await expect(promise).rejects.toThrow('API_KEY_ENCRYPTION_KEY DIFFERS');
    await expect(promise).rejects.not.toThrow('deploy:var-delete');
    expect(deleteRailwayVariable).not.toHaveBeenCalled();
    expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
  });

  it('stage 3 attempts both redeploys and names both services when both redeploys fail', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
    });
    mockPrisma.userApiKey.findMany.mockResolvedValue([]);
    mockPrisma.userCredential.findMany.mockResolvedValue([]);
    redeployRailwayServiceReusingImage.mockRejectedValue(new Error('redeploy boom'));

    const promise = rotateByokKey({ env: 'dev', stage: '3' });
    await expect(promise).rejects.toThrow('api-gateway');
    await expect(promise).rejects.toThrow('ai-worker');
    expect(redeployRailwayServiceReusingImage).toHaveBeenCalledTimes(2);
    expect(mockPrisma.secretRotation.upsert).not.toHaveBeenCalled();
  });

  it('stage 3 stops with the var-delete repair when a delete fails', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
    });
    mockPrisma.userApiKey.findMany.mockResolvedValue([]);
    mockPrisma.userCredential.findMany.mockResolvedValue([]);
    deleteRailwayVariable
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('delete boom'));

    const promise = rotateByokKey({ env: 'dev', stage: '3' });
    await expect(promise).rejects.toThrow('absent on api-gateway');
    await expect(promise).rejects.toThrow('may still be set on ai-worker');
    await expect(promise).rejects.toThrow(
      'pnpm ops deploy:var-delete --env dev --service ai-worker --name API_KEY_ENCRYPTION_KEY_PREVIOUS --yes'
    );
    expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
    expect(mockPrisma.secretRotation.upsert).not.toHaveBeenCalled();
  });

  it('stage 3 instructs to re-run when the first delete fails', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
    });
    mockPrisma.userApiKey.findMany.mockResolvedValue([]);
    mockPrisma.userCredential.findMany.mockResolvedValue([]);
    deleteRailwayVariable.mockRejectedValueOnce(new Error('delete boom'));

    const promise = rotateByokKey({ env: 'dev', stage: '3' });
    await expect(promise).rejects.toThrow('Re-run stage 3 to retry');
    await expect(promise).rejects.toThrow('Re-run stage 3');
    await expect(promise).rejects.not.toThrow('--service api-gateway');
    expect(deleteRailwayVariable).toHaveBeenCalledTimes(1);
    expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
    expect(mockPrisma.secretRotation.upsert).not.toHaveBeenCalled();
  });

  it('stage 3 records an already-absent service in absentNow when a later delete fails', async () => {
    stubRailwayVarsPerService({
      'api-gateway': { API_KEY_ENCRYPTION_KEY: KEY_A_HEX },
      'ai-worker': { API_KEY_ENCRYPTION_KEY: KEY_A_HEX, API_KEY_ENCRYPTION_KEY_PREVIOUS: '' },
    });
    mockPrisma.userApiKey.findMany.mockResolvedValue([]);
    mockPrisma.userCredential.findMany.mockResolvedValue([]);
    deleteRailwayVariable.mockRejectedValueOnce(new Error('delete boom'));

    const promise = rotateByokKey({ env: 'dev', stage: '3' });
    await expect(promise).rejects.toThrow('absent on api-gateway');
    await expect(promise).rejects.toThrow('may still be set on ai-worker');
    await expect(promise).rejects.toThrow(
      'pnpm ops deploy:var-delete --env dev --service ai-worker --name API_KEY_ENCRYPTION_KEY_PREVIOUS --yes'
    );
    expect(deleteRailwayVariable).toHaveBeenCalledTimes(1);
    expect(deleteRailwayVariable).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: 'svc-ai-worker' })
    );
    expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
    expect(mockPrisma.secretRotation.upsert).not.toHaveBeenCalled();
  });

  it('stage 3 fails before any work when the Railway API token is missing', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
    });
    requireRailwayApiToken.mockImplementation(() => {
      throw new Error('TZUROT_RAILWAY_API_TOKEN_DEV is not set');
    });

    await expect(rotateByokKey({ env: 'dev', stage: '3' })).rejects.toThrow(
      'TZUROT_RAILWAY_API_TOKEN_DEV'
    );
    expect(mockPrisma.userApiKey.findMany).not.toHaveBeenCalled();
    expect(resolveRailwayIds).not.toHaveBeenCalled();
    expect(deleteRailwayVariable).not.toHaveBeenCalled();
    expect(mockPrisma.secretRotation.upsert).not.toHaveBeenCalled();
  });

  it('stage 3 never sends a delete without a service id (it would hit the shared scope)', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
    });
    mockPrisma.userApiKey.findMany.mockResolvedValue([]);
    mockPrisma.userCredential.findMany.mockResolvedValue([]);
    resolveRailwayIds.mockImplementation(() => ({ projectId: 'proj', environmentId: 'envid' }));

    await expect(rotateByokKey({ env: 'dev', stage: '3' })).rejects.toThrow('without a service id');
    expect(deleteRailwayVariable).not.toHaveBeenCalled();
    expect(mockPrisma.secretRotation.upsert).not.toHaveBeenCalled();
  });

  it('stage 3 resolves ids for both services before deleting or redeploying anything', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
    });
    mockPrisma.userApiKey.findMany.mockResolvedValue([]);
    mockPrisma.userCredential.findMany.mockResolvedValue([]);
    resolveRailwayIds.mockImplementation((_env: string, service: string) => {
      if (service === 'ai-worker') {
        throw new Error('unknown service ai-worker');
      }
      return {
        projectId: 'proj',
        environmentId: 'envid',
        serviceId: 'svc-' + service,
      };
    });

    await expect(rotateByokKey({ env: 'dev', stage: '3' })).rejects.toThrow(
      'unknown service ai-worker'
    );
    expect(deleteRailwayVariable).not.toHaveBeenCalled();
    expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
    expect(mockPrisma.secretRotation.upsert).not.toHaveBeenCalled();
  });

  it('stage 3 rejects with the var-delete repair hint when PREVIOUS is present on one service only', async () => {
    stubRailwayVarsPerService({
      'api-gateway': {
        API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
        API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
      },
      'ai-worker': {
        API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      },
    });

    const promise = rotateByokKey({ env: 'dev', stage: '3' });
    await expect(promise).rejects.toThrow('API_KEY_ENCRYPTION_KEY_PREVIOUS DIFFERS');
    await expect(promise).rejects.toThrow('deploy:var-delete');
    expect(deleteRailwayVariable).not.toHaveBeenCalled();
    expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
  });

  it('consistency guard accepts gateway PREVIOUS equal to its CURRENT while worker PREVIOUS is absent', async () => {
    stubRailwayVarsPerService({
      'api-gateway': {
        API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
        API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_A_HEX,
      },
      'ai-worker': {
        API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await expect(rotateByokKey({ env: 'dev', stage: '1' })).resolves.toBeUndefined();
      expect(upsertRailwayVariable).toHaveBeenCalledTimes(4);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('stage 2 refuses when PREVIOUS equals CURRENT (interrupted stage 1)', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_A_HEX,
    });

    await expect(rotateByokKey({ env: 'dev', stage: '2' })).rejects.toThrow(
      'PREVIOUS equals CURRENT (an interrupted stage 1). Re-run stage 1.'
    );
    expect(mockPrisma.userApiKey.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.userApiKey.updateMany).not.toHaveBeenCalled();
    expect(redeployRailwayServiceReusingImageWithSource).not.toHaveBeenCalled();
  });

  it('stage 1 refuses before any upsert when a service deployment is not ready', async () => {
    stubRailwayVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX });
    assertRailwayServiceDeploymentReady.mockImplementation(
      async ({ serviceName }: { serviceName: string }) => {
        if (serviceName === 'ai-worker') {
          throw new Error(
            "ai-worker's latest deployment is INITIALIZING, not SUCCESS — wait for it to settle (or fix it), then re-run. Nothing was changed."
          );
        }
      }
    );

    await expect(rotateByokKey({ env: 'dev', stage: '1' })).rejects.toThrow(
      "ai-worker's latest deployment is INITIALIZING, not SUCCESS"
    );
    expect(upsertRailwayVariable).not.toHaveBeenCalled();
    expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
  });

  it('stage 2 refuses before reencrypting when a service deployment is not ready', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
    });
    assertRailwayServiceDeploymentReady.mockImplementation(
      async ({ serviceName }: { serviceName: string }) => {
        if (serviceName === 'api-gateway') {
          throw new Error(
            "api-gateway's latest deployment is BUILDING, not SUCCESS — wait for it to settle (or fix it), then re-run. Nothing was changed."
          );
        }
      }
    );

    await expect(rotateByokKey({ env: 'dev', stage: '2' })).rejects.toThrow(
      "api-gateway's latest deployment is BUILDING, not SUCCESS"
    );
    expect(mockPrisma.userApiKey.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.userApiKey.updateMany).not.toHaveBeenCalled();
    expect(redeployRailwayServiceReusingImageWithSource).not.toHaveBeenCalled();
  });

  it('stage 3 refuses before deleting PREVIOUS when a service deployment is not ready', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
    });
    mockPrisma.userApiKey.findMany.mockResolvedValue([]);
    mockPrisma.userCredential.findMany.mockResolvedValue([]);
    assertRailwayServiceDeploymentReady.mockImplementation(
      async ({ serviceName }: { serviceName: string }) => {
        if (serviceName === 'ai-worker') {
          throw new Error(
            "ai-worker's latest deployment is INITIALIZING, not SUCCESS — wait for it to settle (or fix it), then re-run. Nothing was changed."
          );
        }
      }
    );

    await expect(rotateByokKey({ env: 'dev', stage: '3' })).rejects.toThrow(
      "ai-worker's latest deployment is INITIALIZING, not SUCCESS"
    );
    expect(deleteRailwayVariable).not.toHaveBeenCalled();
    expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
    expect(mockPrisma.secretRotation.upsert).not.toHaveBeenCalled();
  });
});

describe('showRotationStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prints OVERDUE for entries past their interval and ok within it', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mockPrisma.secretRotation.findMany.mockResolvedValueOnce([
      {
        name: 'byok-encryption-key',
        rotatedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
        intervalDays: 180,
      },
      {
        name: 'internal-service-secret',
        rotatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        intervalDays: 365,
      },
    ]);

    await showRotationStatus({ env: 'dev' });

    const output = logSpy.mock.calls.map(call => String(call[0])).join('\n');
    expect(output).toContain('byok-encryption-key');
    expect(output).toContain('OVERDUE');
    expect(output).toContain('ok');
    logSpy.mockRestore();
  });

  it('prints the seed hint on an empty ledger', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mockPrisma.secretRotation.findMany.mockResolvedValueOnce([]);

    await showRotationStatus({ env: 'dev' });

    const output = logSpy.mock.calls.map(call => String(call[0])).join('\n');
    expect(output).toContain('secrets:mark-rotated');
    logSpy.mockRestore();
  });
});

describe('warnIfCapped', () => {
  it('is silent below the cap and loud (returning true) at it', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(warnIfCapped(3, 'verify userApiKey')).toBe(false);
    expect(logSpy).not.toHaveBeenCalled();

    expect(warnIfCapped(50_000, 'verify userApiKey')).toBe(true);
    expect(String(logSpy.mock.calls[0][0])).toContain('NOT examined');
    logSpy.mockRestore();
  });
});
