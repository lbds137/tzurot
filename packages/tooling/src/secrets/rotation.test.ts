/**
 * Tests for secret-rotation tooling. Real crypto (encryptWithKey fixtures),
 * mocked Railway CLI + Prisma persistence.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encryptWithKey, parseEncryptionKeyMaterial } from '@tzurot/common-types/utils/encryption';

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

/** Mock the railway `variables --json` read for api-gateway. */
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
  beforeEach(() => vi.clearAllMocks());

  it('rejects an unknown stage', async () => {
    await expect(rotateByokKey({ env: 'dev', stage: 'yolo' })).rejects.toThrow('Unknown stage');
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
    // throw. (The round-1 window-guard fix crashed here.)
    stubRailwayVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX });

    await expect(rotateByokKey({ env: 'dev', stage: '1' })).resolves.toBeUndefined();

    const setCalls = mockExecFileSync.mock.calls.filter(
      call => Array.isArray(call[1]) && (call[1] as string[]).includes('--set')
    );
    expect(setCalls).toHaveLength(2); // api-gateway + ai-worker
    for (const call of setCalls) {
      const args = call[1] as string[];
      // Old CURRENT is demoted to PREVIOUS on both services.
      expect(args.some(arg => arg === `API_KEY_ENCRYPTION_KEY_PREVIOUS=${KEY_A_HEX}`)).toBe(true);
      // A fresh CURRENT is minted (present, and not the old key).
      expect(
        args.some(
          arg =>
            arg.startsWith('API_KEY_ENCRYPTION_KEY=') &&
            arg !== `API_KEY_ENCRYPTION_KEY=${KEY_A_HEX}`
        )
      ).toBe(true);
    }
  });

  it('stage 1 refuses while a rotation window is already open (would orphan unmigrated rows)', async () => {
    stubRailwayVars({
      API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
      API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
    });

    await expect(rotateByokKey({ env: 'dev', stage: '1' })).rejects.toThrow('already open');
    // No variable writes may have happened.
    const setCalls = mockExecFileSync.mock.calls.filter(
      call => Array.isArray(call[1]) && (call[1] as string[]).includes('--set')
    );
    expect(setCalls).toHaveLength(0);
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
    expect(mockPrisma.secretRotation.upsert).not.toHaveBeenCalled();
  });

  it('stage 3 clears PREVIOUS on both services and stamps the ledger when clean', async () => {
    stubRailwayVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX });
    mockPrisma.userApiKey.findMany.mockResolvedValue([]);
    mockPrisma.userCredential.findMany.mockResolvedValue([]);
    mockPrisma.secretRotation.upsert.mockResolvedValue({});

    await rotateByokKey({ env: 'dev', stage: 'finalize' });

    const setCalls = mockExecFileSync.mock.calls.filter(
      call => Array.isArray(call[1]) && (call[1] as string[]).includes('--set')
    );
    expect(setCalls).toHaveLength(2); // api-gateway + ai-worker
    for (const call of setCalls) {
      expect(call[1]).toContain('API_KEY_ENCRYPTION_KEY_PREVIOUS=');
    }
    expect(mockPrisma.secretRotation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'byok-encryption-key' } })
    );
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
