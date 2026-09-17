/**
 * `digestRefresh` — mocked-prisma test asserting the exact `$executeRaw`
 * args (C10, ops half): the write sets `digest_status='pending'` and stamps
 * `requested_at`, and never touches `digest_text`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock, executeMock, requireProdConfirmMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  executeMock: vi.fn().mockResolvedValue(1),
  requireProdConfirmMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/env-runner.js', () => ({
  validateEnvironment: vi.fn(),
  showEnvironmentBanner: vi.fn(),
  requireProductionConfirmation: requireProdConfirmMock,
}));

vi.mock('../memory/prisma-env.js', () => ({
  getPrismaForEnv: vi.fn().mockResolvedValue({
    prisma: { $queryRaw: queryMock, $executeRaw: executeMock },
    disconnect: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { digestRefresh } from './refresh.js';
import { UsageError } from '../utils/errors.js';

const PERSONA_ID = '4f9b0f66-3333-4000-8000-000000000001';
const PERSONALITY_ID = '4f9b0f66-3333-4000-8000-000000000002';

/** Route `$queryRaw` by a distinctive substring of the joined SQL text —
 *  the personality-slug lookup vs. the before/after row snapshot. */
function routeQuery(rowSnapshots: (Record<string, unknown> | null)[]): void {
  let snapshotIndex = 0;
  queryMock.mockImplementation((strings: TemplateStringsArray) => {
    const sql = strings.join('');
    if (sql.includes('FROM personalities')) {
      return Promise.resolve([{ id: PERSONALITY_ID }]);
    }
    if (sql.includes('FROM persona_personality_digests')) {
      const row = rowSnapshots[snapshotIndex];
      snapshotIndex += 1;
      return Promise.resolve(row === null ? [] : [row]);
    }
    throw new Error(`unexpected query: ${sql}`);
  });
}

describe('digestRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue(1);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('throws a UsageError when the personality slug does not resolve', async () => {
    queryMock.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join('');
      if (sql.includes('FROM personalities')) return Promise.resolve([]);
      throw new Error(`unexpected query: ${sql}`);
    });

    await expect(
      digestRefresh({ env: 'dev', personaId: PERSONA_ID, personalitySlug: 'nope' })
    ).rejects.toBeInstanceOf(UsageError);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('performs no write in --dry-run mode', async () => {
    routeQuery([null]);
    await digestRefresh({
      env: 'dev',
      personaId: PERSONA_ID,
      personalitySlug: 'char-a',
      dryRun: true,
    });
    expect(executeMock).not.toHaveBeenCalled();
  });

  // Canary C10 (refresh half): the write sets digest_status='pending' and
  // stamps requested_at, and the values array carries no digest_text field.
  // Mutation: drop the `requested_at = NOW()` clause from the ON CONFLICT
  // arm → this reds (the assertion on the joined SQL text stops matching).
  it('upserts digest_status=pending + requested_at=NOW(), leaving digest_text untouched', async () => {
    routeQuery([
      null,
      {
        digest_status: 'pending',
        digest_attempts: 0,
        requested_at: new Date(),
        generated_at: null,
      },
    ]);

    await digestRefresh({
      env: 'dev',
      personaId: PERSONA_ID,
      personalitySlug: 'char-a',
      force: true,
    });

    expect(executeMock).toHaveBeenCalledTimes(1);
    const [strings, ...values] = executeMock.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join('');

    expect(sql).toContain('digest_status, requested_at, created_at, updated_at');
    expect(sql).toContain('ON CONFLICT (persona_id, personality_id) DO UPDATE');
    expect(sql).toContain('digest_status =');
    expect(sql).toContain('requested_at = NOW()');
    expect(sql).not.toContain('digest_text');
    expect(values).toContain('pending');
    expect(values).toContain(PERSONA_ID);
    expect(values).toContain(PERSONALITY_ID);
  });

  it('requires production confirmation on a non-dry-run prod write without --force', async () => {
    routeQuery([
      null,
      {
        digest_status: 'pending',
        digest_attempts: 0,
        requested_at: new Date(),
        generated_at: null,
      },
    ]);

    await digestRefresh({
      env: 'prod',
      personaId: PERSONA_ID,
      personalitySlug: 'char-a',
    });

    expect(requireProdConfirmMock).toHaveBeenCalledTimes(1);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('skips the production confirmation with --force', async () => {
    routeQuery([
      null,
      {
        digest_status: 'pending',
        digest_attempts: 0,
        requested_at: new Date(),
        generated_at: null,
      },
    ]);

    await digestRefresh({
      env: 'prod',
      personaId: PERSONA_ID,
      personalitySlug: 'char-a',
      force: true,
    });

    expect(requireProdConfirmMock).not.toHaveBeenCalled();
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});
