/**
 * Unit test: the JS-side half of `selectDigestCandidatePairs` — the
 * empty-slug short-circuit and the raw-row-to-`DigestCandidatePair` mapping.
 * The SQL semantics themselves are pinned by the PGLite component test —
 * this file mocks the seam and asserts what crosses it.
 */

import { describe, expect, it, vi } from 'vitest';
import { selectDigestCandidatePairs } from './recentDaysDigestSelection.js';

function fakePrisma(rows: unknown[]): { $queryRaw: ReturnType<typeof vi.fn> } {
  return { $queryRaw: vi.fn().mockResolvedValue(rows) };
}

describe('selectDigestCandidatePairs', () => {
  it('returns [] and never queries when personalitySlugs is empty', async () => {
    const prisma = fakePrisma([]);
    const result = await selectDigestCandidatePairs(
      prisma as unknown as Parameters<typeof selectDigestCandidatePairs>[0],
      { personalitySlugs: [], promptVersion: 1, limit: 10 }
    );
    expect(result).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('maps a raw row to the camelCase pair shape, coercing window_row_count to a number', async () => {
    const generatedAt = new Date('2026-09-10T00:00:00.000Z');
    const prisma = fakePrisma([
      {
        persona_id: 'persona-1',
        personality_id: 'personality-1',
        personality_slug: 'char-a',
        owner_id: 'owner-1',
        owner_timezone: 'America/New_York',
        persona_name: 'Persona One',
        persona_preferred_name: null,
        personality_name: 'Char A',
        personality_display_name: null,
        epoch: null,
        newest_row_at: generatedAt,
        window_row_count: 42n,
        digest_id: 'digest-1',
        digest_status: 'done',
        digest_attempts: 0,
        source_watermark: generatedAt,
        generated_at: generatedAt,
        requested_at: null,
      },
    ]);
    const result = await selectDigestCandidatePairs(
      prisma as unknown as Parameters<typeof selectDigestCandidatePairs>[0],
      { personalitySlugs: ['char-a'], promptVersion: 1, limit: 10 }
    );
    expect(result).toEqual([
      {
        personaId: 'persona-1',
        personalityId: 'personality-1',
        personalitySlug: 'char-a',
        ownerId: 'owner-1',
        ownerTimezone: 'America/New_York',
        personaName: 'Persona One',
        personaPreferredName: null,
        personalityName: 'Char A',
        personalityDisplayName: null,
        epoch: null,
        newestRowAt: generatedAt,
        windowRowCount: 42,
        digestId: 'digest-1',
        digestStatus: 'done',
        digestAttempts: 0,
        sourceWatermark: generatedAt,
        generatedAt,
        requestedAt: null,
      },
    ]);
  });
});
