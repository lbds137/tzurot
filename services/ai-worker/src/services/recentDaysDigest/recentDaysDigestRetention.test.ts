import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { RECENT_DAYS_DIGEST } from '@tzurot/common-types/constants/recentDaysDigest';

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => loggerMock };
});

import { sweepStaleRecentDaysDigests } from './recentDaysDigestRetention.js';

const NOW = new Date('2026-09-18T12:00:00.000Z');
const MS_PER_DAY = 86_400_000;

function makePrisma(executeRawResult: number): {
  prisma: PrismaClient;
  executeRawMock: ReturnType<typeof vi.fn>;
} {
  const executeRawMock = vi.fn().mockResolvedValue(executeRawResult);
  const prisma = { $executeRaw: executeRawMock } as unknown as PrismaClient;
  return { prisma, executeRawMock };
}

describe('sweepStaleRecentDaysDigests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('computes cutoff as now - (WINDOW_DAYS + STALE_SWEEP_GRACE_DAYS) and passes it first', async () => {
    const { prisma, executeRawMock } = makePrisma(3);

    const result = await sweepStaleRecentDaysDigests(prisma);

    const expectedCutoff = new Date(
      NOW.getTime() -
        (RECENT_DAYS_DIGEST.WINDOW_DAYS + RECENT_DAYS_DIGEST.STALE_SWEEP_GRACE_DAYS) * MS_PER_DAY
    );
    expect(result.cutoff.getTime()).toBe(expectedCutoff.getTime());

    const call = executeRawMock.mock.calls[0] as unknown[];
    const firstValue = call[1] as Date;
    expect(firstValue.getTime()).toBe(expectedCutoff.getTime());
  });

  it('passes now - WINDOW_DAYS as the second interpolated value (the window bound)', async () => {
    const { prisma, executeRawMock } = makePrisma(0);

    await sweepStaleRecentDaysDigests(prisma);

    const expectedWindowStart = new Date(
      NOW.getTime() - RECENT_DAYS_DIGEST.WINDOW_DAYS * MS_PER_DAY
    );
    const call = executeRawMock.mock.calls[0] as unknown[];
    const secondValue = call[2] as Date;
    expect(secondValue.getTime()).toBe(expectedWindowStart.getTime());
  });

  it('returns deletedCount as whatever $executeRaw resolved to', async () => {
    const { prisma } = makePrisma(7);

    const result = await sweepStaleRecentDaysDigests(prisma);

    expect(result.deletedCount).toBe(7);
  });

  it('the SQL text contains NOT EXISTS, generated_at IS NOT NULL, and the table name', async () => {
    const { prisma, executeRawMock } = makePrisma(0);

    await sweepStaleRecentDaysDigests(prisma);

    const call = executeRawMock.mock.calls[0] as unknown[];
    const strings = call[0] as TemplateStringsArray;
    const sql = strings.join('');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('generated_at IS NOT NULL');
    expect(sql).toContain('persona_personality_digests');
  });
});
