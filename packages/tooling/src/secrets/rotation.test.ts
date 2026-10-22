/**
 * Tests for secret-rotation tooling. Real crypto (encryptWithKey fixtures),
 * mocked Railway CLI + Prisma persistence.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encryptWithKey, parseEncryptionKeyMaterial } from '@tzurot/common-types/utils/encryption';
import type { RailwayIds } from '../deployment/railway-status.js';

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
  requireRailwayApiToken,
  upsertRailwayVariable,
  deleteRailwayVariable,
  redeployRailwayServiceReusingImage,
  resolveRailwayIds,
} = vi.hoisted(() => ({
  requireRailwayApiToken: vi.fn(),
  upsertRailwayVariable: vi.fn(),
  deleteRailwayVariable: vi.fn(),
  redeployRailwayServiceReusingImage: vi.fn(),
  resolveRailwayIds: vi.fn((_env: string, service: string): RailwayIds => ({
    projectId: 'proj',
    environmentId: 'envid',
    serviceId: 'svc-' + service,
  })),
}));

vi.mock('../deployment/railway-api.js', () => ({
  requireRailwayApiToken,
  upsertRailwayVariable,
  deleteRailwayVariable,
  redeployRailwayServiceReusingImage,
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
    requireRailwayApiToken.mockReturnValue('test-token');
    upsertRailwayVariable.mockResolvedValue(undefined);
    deleteRailwayVariable.mockResolvedValue(undefined);
    redeployRailwayServiceReusingImage.mockResolvedValue('dep-new');
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
        env: 'dev',
      });
      expect(redeployRailwayServiceReusingImage).toHaveBeenCalledWith({
        projectId: 'proj',
        environmentId: 'envid',
        serviceId: 'svc-ai-worker',
        env: 'dev',
      });

      const lastUpsertOrder = Math.max(...upsertRailwayVariable.mock.invocationCallOrder);
      const firstRedeployOrder = Math.min(
        ...redeployRailwayServiceReusingImage.mock.invocationCallOrder
      );
      expect(lastUpsertOrder).toBeLessThan(firstRedeployOrder);

      const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
      expect(allOutput).not.toMatch(/[0-9a-f]{64}/);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('stage 1 stops before any redeploy when an upsert fails, with no key material in the error', async () => {
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
    expect(message).toContain('api-gateway');
    expect(message).toContain('API_KEY_ENCRYPTION_KEY_PREVIOUS');
    expect(message).toContain('stage 2');
    expect(message).not.toContain(KEY_A_HEX);
    expect(message).not.toMatch(/[0-9a-f]{64}/);
    expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
  });

  it('stage 1 attempts both redeploys and throws when one service fails to redeploy', async () => {
    stubRailwayVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX });
    redeployRailwayServiceReusingImage.mockImplementation(({ serviceId }: { serviceId: string }) =>
      serviceId === 'svc-api-gateway'
        ? Promise.reject(new Error('redeploy boom'))
        : Promise.resolve('dep-new')
    );

    const promise = rotateByokKey({ env: 'dev', stage: '1' });
    await expect(promise).rejects.toThrow('api-gateway');
    await expect(promise).rejects.toThrow('Railway dashboard');
    await expect(promise).rejects.toThrow('stage 2');
    expect(redeployRailwayServiceReusingImage).toHaveBeenCalledTimes(2);
  });

  it('stage 1 refuses while a rotation window is already open (would orphan unmigrated rows)', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
    });

    await expect(rotateByokKey({ env: 'dev', stage: '1' })).rejects.toThrow('already open');
    // No variable writes or redeploys may have happened.
    const setCalls = mockExecFileSync.mock.calls.filter(
      call => Array.isArray(call[1]) && (call[1] as string[]).includes('--set')
    );
    expect(setCalls).toHaveLength(0);
    expect(upsertRailwayVariable).not.toHaveBeenCalled();
    expect(redeployRailwayServiceReusingImage).not.toHaveBeenCalled();
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
      env: 'dev',
    });
    expect(redeployRailwayServiceReusingImage).toHaveBeenCalledWith({
      projectId: 'proj',
      environmentId: 'envid',
      serviceId: 'svc-ai-worker',
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

  it('stage 3 does not stamp the ledger when a redeploy fails', async () => {
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
    await expect(promise).rejects.toThrow('mark-rotated');
    await expect(promise).rejects.toThrow('re-run stage 3');
    await expect(promise).rejects.not.toThrow('api-gateway');
    expect(redeployRailwayServiceReusingImage).toHaveBeenCalledTimes(2);
    expect(mockPrisma.secretRotation.upsert).not.toHaveBeenCalled();
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
