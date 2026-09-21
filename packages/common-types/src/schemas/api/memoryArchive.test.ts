/**
 * Memory-archive auto-promotion wire-contract schema tests.
 */

import { describe, it, expect } from 'vitest';
import {
  MemoryArchivePromoteRequestSchema,
  MemoryArchivePromoteResponseSchema,
  MemoryArchivePromotionSchema,
} from './memoryArchive.js';

describe('MemoryArchivePromotionSchema', () => {
  function validPromotion() {
    return {
      personalityId: '550e8400-e29b-41d4-a716-446655440001',
      slug: 'my-persona',
      coverage: 0.97,
      writes: { archiveSplitRender: true, recentDaysDigest: true, renderMode: true },
    };
  }

  it('rejects a promotion whose writes lack renderMode', () =>
    expect(
      MemoryArchivePromotionSchema.safeParse({
        personalityId: 'p',
        slug: 's',
        coverage: 1,
        writes: { archiveSplitRender: true, recentDaysDigest: true },
      }).success
    ).toBe(false));

  it('rejects a coverage above 1', () => {
    const data = { ...validPromotion(), coverage: 1.5 };
    expect(MemoryArchivePromotionSchema.safeParse(data).success).toBe(false);
  });

  it('rejects a non-UUID personalityId', () => {
    const data = { ...validPromotion(), personalityId: 'not-a-uuid' };
    expect(MemoryArchivePromotionSchema.safeParse(data).success).toBe(false);
  });

  it('rejects an empty slug', () => {
    const data = { ...validPromotion(), slug: '' };
    expect(MemoryArchivePromotionSchema.safeParse(data).success).toBe(false);
  });
});

describe('MemoryArchivePromoteRequestSchema', () => {
  it('accepts an empty body', () => {
    expect(MemoryArchivePromoteRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts an explicit dryRun', () => {
    expect(MemoryArchivePromoteRequestSchema.safeParse({ dryRun: true }).success).toBe(true);
  });

  it('rejects a non-boolean dryRun', () => {
    expect(MemoryArchivePromoteRequestSchema.safeParse({ dryRun: 'yes' }).success).toBe(false);
  });
});

describe('MemoryArchivePromoteResponseSchema', () => {
  function validResponse() {
    return {
      enabled: true,
      evaluated: 5,
      promoted: [
        {
          personalityId: '550e8400-e29b-41d4-a716-446655440001',
          slug: 'my-persona',
          coverage: 0.97,
          writes: {
            archiveSplitRender: true,
            recentDaysDigest: true,
            renderMode: true,
          },
        },
      ],
      skipped: {
        notReady: 2,
        optedOut: 1,
        alreadyListed: 0,
        conflicted: 0,
      },
    };
  }

  it('parses a full, valid response', () => {
    const result = MemoryArchivePromoteResponseSchema.safeParse(validResponse());
    expect(result.success).toBe(true);
  });

  it('rejects a response missing skipped.optedOut', () => {
    const data = validResponse();
    // @ts-expect-error -- deliberately malformed fixture for the negative test
    delete data.skipped.optedOut;
    const result = MemoryArchivePromoteResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('does not strip a promotion writes sub-object on round-trip', () => {
    const data = validResponse();
    const result = MemoryArchivePromoteResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.promoted[0]?.writes).toEqual({
        archiveSplitRender: true,
        recentDaysDigest: true,
        renderMode: true,
      });
    }
  });
});
