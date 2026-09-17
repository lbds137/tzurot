/**
 * Unit test: the JS-side control flow of the store functions (which pairs
 * get an INSERT, what the affected-row count forwards as). The SQL guard
 * semantics themselves are pinned by `recentDaysDigestStore.component.test.ts`
 * against real Postgres — mocking `$executeRaw` here cannot verify those.
 */

import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  materializePendingRows,
  storeDigestSuccess,
  recordDigestFailure,
  readDigestStatus,
} from './recentDaysDigestStore.js';

function fakePrisma(queryRows: unknown[] = []): {
  $executeRaw: ReturnType<typeof vi.fn>;
  $queryRaw: ReturnType<typeof vi.fn>;
} {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue(queryRows),
  };
}

describe('materializePendingRows', () => {
  it('does not INSERT for a pair that already has a digestId', async () => {
    const prisma = fakePrisma();
    const ids = await materializePendingRows(prisma as unknown as PrismaClient, [
      { personaId: 'p1', personalityId: 'c1', digestId: 'existing' },
    ]);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(ids.get('p1:c1')).toBe('existing');
  });

  it('INSERTs and re-reads for a pair with no digestId', async () => {
    const prisma = fakePrisma([{ id: 'reread-id' }]);
    const ids = await materializePendingRows(prisma as unknown as PrismaClient, [
      { personaId: 'p1', personalityId: 'c1', digestId: null },
    ]);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(ids.get('p1:c1')).toBe('reread-id');
  });
});

describe('storeDigestSuccess', () => {
  it('forwards the affected-row count from $executeRaw', async () => {
    const prisma = fakePrisma();
    (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    const affected = await storeDigestSuccess(prisma as unknown as PrismaClient, {
      id: 'id-1',
      seenRequestedAt: null,
      text: 'digest text',
      model: 'z-ai/glm-5.2',
      promptVersion: 1,
      sourceWatermark: new Date(),
      windowStart: new Date(),
      sourceRowCount: 2,
      sourceRowIds: ['r1', 'r2'],
      sourceEpoch: null,
    });
    expect(affected).toBe(0);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

describe('readDigestStatus', () => {
  it('returns the status column of the matching row', async () => {
    const prisma = fakePrisma([{ digest_status: 'failed' }]);
    const status = await readDigestStatus(prisma as unknown as PrismaClient, 'id-1');
    expect(status).toBe('failed');
  });

  it('returns null when no row matches', async () => {
    const prisma = fakePrisma([]);
    const status = await readDigestStatus(prisma as unknown as PrismaClient, 'id-1');
    expect(status).toBeNull();
  });
});

describe('recordDigestFailure', () => {
  it('forwards the affected-row count from $executeRaw', async () => {
    const prisma = fakePrisma();
    (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    const affected = await recordDigestFailure(prisma as unknown as PrismaClient, {
      id: 'id-1',
      seenRequestedAt: null,
      attemptedWatermark: new Date(),
      promptVersion: 1,
      errorClass: 'parse_failure',
    });
    expect(affected).toBe(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
