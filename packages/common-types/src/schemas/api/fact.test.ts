/**
 * Schema tests for memory-fact API types (memory Phase 2).
 *
 * Unit-tier per the taxonomy: these validate the fact schemas' own rules
 * (accept/reject shapes), not cross-service agreement.
 */

import { describe, it, expect } from 'vitest';
import {
  FactItemSchema,
  FactListResponseSchema,
  FactTierSchema,
  CorrectFactRequestSchema,
  CorrectFactResponseSchema,
  ForgetFactResponseSchema,
} from './fact.js';

const validFact = {
  id: '4f9b0f66-0000-4000-8000-000000000001',
  personalityId: '4f9b0f66-0000-4000-8000-000000000002',
  personaId: '4f9b0f66-0000-4000-8000-000000000003',
  statement: "Alice's cat is named Miso",
  entityTags: ['user:alice', 'pet:miso'],
  salience: 0.7,
  tier: 'observed',
  isLocked: false,
  validFrom: '2026-07-06T12:00:00.000Z',
  supersededAt: null,
  supersededById: null,
  forgotten: false,
  sourceMemoryIds: ['4f9b0f66-0000-4000-8000-000000000004'],
  createdAt: '2026-07-06T12:00:00.000Z',
};

describe('FactTierSchema', () => {
  it('accepts the three tier values', () => {
    for (const tier of ['observed', 'inferred', 'corrected']) {
      expect(FactTierSchema.safeParse(tier).success).toBe(true);
    }
  });

  it('rejects unknown tiers', () => {
    expect(FactTierSchema.safeParse('speculative').success).toBe(false);
  });
});

describe('FactItemSchema', () => {
  it('accepts a valid current fact', () => {
    expect(FactItemSchema.safeParse(validFact).success).toBe(true);
  });

  it('accepts a superseded fact (supersession fields populated)', () => {
    const superseded = {
      ...validFact,
      supersededAt: '2026-07-06T13:00:00.000Z',
      supersededById: '4f9b0f66-0000-4000-8000-000000000005',
    };
    expect(FactItemSchema.safeParse(superseded).success).toBe(true);
  });

  it('accepts a null personaId (world/canon facts)', () => {
    expect(FactItemSchema.safeParse({ ...validFact, personaId: null }).success).toBe(true);
  });

  it('rejects a non-ISO validFrom (serialization contract)', () => {
    const raw = { ...validFact, validFrom: '2026-07-06' };
    expect(FactItemSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects out-of-range salience (contract is 0..1)', () => {
    expect(FactItemSchema.safeParse({ ...validFact, salience: 1.5 }).success).toBe(false);
    expect(FactItemSchema.safeParse({ ...validFact, salience: -0.1 }).success).toBe(false);
  });

  it('rejects a missing statement', () => {
    const { statement: _statement, ...rest } = validFact;
    expect(FactItemSchema.safeParse(rest).success).toBe(false);
  });
});

describe('FactListResponseSchema', () => {
  it('accepts a paged list', () => {
    const list = { facts: [validFact], total: 1, limit: 20, offset: 0, hasMore: false };
    expect(FactListResponseSchema.safeParse(list).success).toBe(true);
  });
});

describe('CorrectFactRequestSchema', () => {
  it('trims and accepts a corrected statement', () => {
    const parsed = CorrectFactRequestSchema.parse({ statement: '  Alice moved to Portland  ' });
    expect(parsed.statement).toBe('Alice moved to Portland');
  });

  it('rejects an empty statement after trim', () => {
    expect(CorrectFactRequestSchema.safeParse({ statement: '   ' }).success).toBe(false);
  });

  it('rejects an over-length statement', () => {
    expect(CorrectFactRequestSchema.safeParse({ statement: 'x'.repeat(1001) }).success).toBe(false);
  });
});

describe('CorrectFactResponseSchema', () => {
  it('accepts the superseding-fact response', () => {
    const res = {
      fact: { ...validFact, tier: 'corrected' },
      supersededFactId: validFact.id,
    };
    expect(CorrectFactResponseSchema.safeParse(res).success).toBe(true);
  });
});

describe('ForgetFactResponseSchema', () => {
  it('requires forgotten to be literally true', () => {
    expect(ForgetFactResponseSchema.safeParse({ id: validFact.id, forgotten: true }).success).toBe(
      true
    );
    expect(ForgetFactResponseSchema.safeParse({ id: validFact.id, forgotten: false }).success).toBe(
      false
    );
  });
});
