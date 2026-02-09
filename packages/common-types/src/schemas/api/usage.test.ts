/**
 * Usage API Contract Tests
 *
 * Validates schemas for /user/usage endpoints.
 */

import { describe, it, expect } from 'vitest';
import { UsageBreakdownSchema, UsagePeriodSchema, UsageStatsSchema } from './usage.js';

describe('Usage API Contract Tests', () => {
  describe('UsageBreakdownSchema', () => {
    it('should accept valid breakdown', () => {
      const data = { requests: 10, tokensIn: 5000, tokensOut: 3000 };
      const result = UsageBreakdownSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept zeroes', () => {
      const data = { requests: 0, tokensIn: 0, tokensOut: 0 };
      const result = UsageBreakdownSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject negative values', () => {
      const data = { requests: -1, tokensIn: 0, tokensOut: 0 };
      const result = UsageBreakdownSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing fields', () => {
      const result = UsageBreakdownSchema.safeParse({ requests: 5 });
      expect(result.success).toBe(false);
    });
  });

  describe('UsagePeriodSchema', () => {
    it.each(['day', 'week', 'month', 'all'] as const)('should accept "%s"', period => {
      const result = UsagePeriodSchema.safeParse(period);
      expect(result.success).toBe(true);
    });

    it('should reject invalid period', () => {
      const result = UsagePeriodSchema.safeParse('year');
      expect(result.success).toBe(false);
    });
  });

  describe('UsageStatsSchema', () => {
    const validStats = {
      period: 'month' as const,
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-02-01T00:00:00.000Z',
      totalRequests: 42,
      totalTokensIn: 10000,
      totalTokensOut: 8000,
      totalTokens: 18000,
      byProvider: {
        openrouter: { requests: 42, tokensIn: 10000, tokensOut: 8000 },
      },
      byModel: {
        'claude-sonnet-4': { requests: 42, tokensIn: 10000, tokensOut: 8000 },
      },
      byRequestType: {
        chat: { requests: 42, tokensIn: 10000, tokensOut: 8000 },
      },
    };

    it('should accept valid stats', () => {
      const result = UsageStatsSchema.safeParse(validStats);
      expect(result.success).toBe(true);
    });

    it('should accept stats with null periodStart (all-time)', () => {
      const data = { ...validStats, periodStart: null };
      const result = UsageStatsSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept stats with limitReached flag', () => {
      const data = { ...validStats, limitReached: true };
      const result = UsageStatsSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept empty breakdown records', () => {
      const data = {
        ...validStats,
        byProvider: {},
        byModel: {},
        byRequestType: {},
      };
      const result = UsageStatsSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject invalid period', () => {
      const data = { ...validStats, period: 'year' };
      const result = UsageStatsSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const result = UsageStatsSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject invalid breakdown in byProvider', () => {
      const data = {
        ...validStats,
        byProvider: { openrouter: { requests: -1, tokensIn: 0, tokensOut: 0 } },
      };
      const result = UsageStatsSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });
});
