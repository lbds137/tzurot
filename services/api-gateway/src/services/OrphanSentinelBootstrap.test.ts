import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { generateUserUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { ORPHAN_SENTINEL_DISCORD_ID } from '@tzurot/common-types/constants/persona';
import { ensureOrphanSentinel } from './OrphanSentinelBootstrap.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

/** Join the template-strings array (call[0]) so we can assert on the SQL skeleton. */
function joinSql(call: unknown[]): string {
  return (call[0] as TemplateStringsArray).join(' ');
}

describe('ensureOrphanSentinel', () => {
  it('creates the sentinel via an idempotent, retention-exempt, non-superuser CTE and returns its deterministic id', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ created: true }]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient;

    const id = await ensureOrphanSentinel(prisma);

    // Deterministic id — derived from the reserved discordId, so dev and prod converge.
    expect(id).toBe(generateUserUuid(ORPHAN_SENTINEL_DISCORD_ID));
    // Pinned value: the sentinel id is load-bearing (db-sync convergence +
    // reclamation provenance). If this breaks, ORPHAN_SENTINEL_DISCORD_ID
    // changed — existing sentinel rows would strand under a new id, so a data
    // migration is required, not just a constant edit.
    expect(id).toBe('266ae4ef-5690-57eb-9a3e-1c3c299845ec');

    expect(queryRaw).toHaveBeenCalledOnce();
    const sql = joinSql(queryRaw.mock.calls[0]);
    // Idempotency + the two policy flags that keep the sentinel out of the purge.
    expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
    expect(sql).toContain('retention_exempt');
    expect(sql).toContain('is_superuser');
    // The reserved discordId + the sentinel id cross the $queryRaw seam as values.
    expect(queryRaw.mock.calls[0]).toEqual(
      expect.arrayContaining([ORPHAN_SENTINEL_DISCORD_ID, id])
    );
  });

  it('is idempotent — a second call returns the same id and re-issues the DO NOTHING insert', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ created: true }])
      .mockResolvedValueOnce([{ created: false }]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient;

    const first = await ensureOrphanSentinel(prisma);
    const second = await ensureOrphanSentinel(prisma);

    expect(first).toBe(second);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});
