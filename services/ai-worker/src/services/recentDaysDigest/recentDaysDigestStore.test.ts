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
  readRenderableDigest,
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
  it('returns the status and attempts columns of the matching row', async () => {
    const prisma = fakePrisma([{ digest_status: 'failed', digest_attempts: 1 }]);
    const result = await readDigestStatus(prisma as unknown as PrismaClient, 'id-1');
    expect(result).toEqual({ status: 'failed', attempts: 1 });
  });

  it('returns nulls for both fields when no row matches', async () => {
    const prisma = fakePrisma([]);
    const result = await readDigestStatus(prisma as unknown as PrismaClient, 'id-1');
    expect(result).toEqual({ status: null, attempts: null });
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

describe('readRenderableDigest', () => {
  it('returns null when no rows match', async () => {
    const prisma = fakePrisma([]);
    const result = await readRenderableDigest(
      prisma as unknown as PrismaClient,
      'persona-1',
      'personality-1'
    );
    expect(result).toBeNull();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns null when digest_text is null', async () => {
    const prisma = fakePrisma([
      { digest_text: null, generated_at: new Date(), source_epoch: null },
    ]);
    const result = await readRenderableDigest(
      prisma as unknown as PrismaClient,
      'persona-1',
      'personality-1'
    );
    expect(result).toBeNull();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns null when digest_text is empty', async () => {
    const prisma = fakePrisma([{ digest_text: '', generated_at: new Date(), source_epoch: null }]);
    const result = await readRenderableDigest(
      prisma as unknown as PrismaClient,
      'persona-1',
      'personality-1'
    );
    expect(result).toBeNull();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns null when generated_at is null', async () => {
    const prisma = fakePrisma([{ digest_text: 'x', generated_at: null, source_epoch: null }]);
    const result = await readRenderableDigest(
      prisma as unknown as PrismaClient,
      'persona-1',
      'personality-1'
    );
    expect(result).toBeNull();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns the renderable shape for a full row', async () => {
    const generatedAt = new Date('2026-09-01T00:00:00Z');
    const sourceEpoch = new Date('2026-08-25T00:00:00Z');
    const prisma = fakePrisma([
      {
        digest_text: 'Jules and Nova talked.',
        generated_at: generatedAt,
        source_epoch: sourceEpoch,
      },
    ]);
    const result = await readRenderableDigest(
      prisma as unknown as PrismaClient,
      'persona-1',
      'personality-1'
    );
    expect(result).toEqual({ text: 'Jules and Nova talked.', generatedAt, sourceEpoch });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('defaults sourceEpoch to null when absent from the row', async () => {
    const generatedAt = new Date('2026-09-01T00:00:00Z');
    const prisma = fakePrisma([
      { digest_text: 'Jules and Nova talked.', generated_at: generatedAt },
    ]);
    const result = await readRenderableDigest(
      prisma as unknown as PrismaClient,
      'persona-1',
      'personality-1'
    );
    expect(result?.sourceEpoch).toBeNull();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
