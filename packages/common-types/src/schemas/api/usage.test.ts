/**
 * Usage API Contract Tests
 *
 * Validates schemas for /user/usage endpoints.
 */

import { describe, it, expect } from 'vitest';
import {
  AdminUsageStatsSchema,
  TopUserUsageSchema,
  UsageBreakdownSchema,
  UsagePeriodSchema,
  UsageStatsSchema,
} from './usage.js';

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

  describe('TopUserUsageSchema', () => {
    it('should accept a valid top-user entry', () => {
      const data = { discordId: '123456789012345678', requests: 50, tokens: 12000 };
      expect(TopUserUsageSchema.safeParse(data).success).toBe(true);
    });

    it('should accept zero requests / zero tokens', () => {
      const data = { discordId: '1', requests: 0, tokens: 0 };
      expect(TopUserUsageSchema.safeParse(data).success).toBe(true);
    });

    it('should reject negative request count', () => {
      const data = { discordId: '1', requests: -1, tokens: 0 };
      expect(TopUserUsageSchema.safeParse(data).success).toBe(false);
    });

    it('should reject negative token count', () => {
      const data = { discordId: '1', requests: 1, tokens: -1 };
      expect(TopUserUsageSchema.safeParse(data).success).toBe(false);
    });

    it('should reject missing discordId', () => {
      expect(TopUserUsageSchema.safeParse({ requests: 1, tokens: 1 }).success).toBe(false);
    });
  });

  describe('AdminUsageStatsSchema', () => {
    const validAdminStats = {
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-01-08T00:00:00.000Z',
      totalRequests: 100,
      totalTokensIn: 50000,
      totalTokensOut: 30000,
      totalTokens: 80000,
      byProvider: { openrouter: { requests: 100, tokensIn: 50000, tokensOut: 30000 } },
      byModel: { 'claude-sonnet-4': { requests: 100, tokensIn: 50000, tokensOut: 30000 } },
      byRequestType: { chat: { requests: 100, tokensIn: 50000, tokensOut: 30000 } },
      // Admin-only fields:
      timeframe: '7d',
      uniqueUsers: 5,
      topUsers: [{ discordId: '111', requests: 50, tokens: 40000 }],
    };

    it('should accept valid admin stats with all admin-only fields', () => {
      expect(AdminUsageStatsSchema.safeParse(validAdminStats).success).toBe(true);
    });

    it('should accept empty topUsers array', () => {
      const data = { ...validAdminStats, topUsers: [] };
      expect(AdminUsageStatsSchema.safeParse(data).success).toBe(true);
    });

    it('does NOT require the per-user `period` field (admin endpoint uses freeform timeframe)', () => {
      // Regression guard: an earlier draft of this schema extended
      // UsageStatsSchema, which forced `period` to be present. The
      // api-gateway /admin/usage handler doesn't return `period` (it
      // uses `timeframe` instead), so requiring it would have broken
      // every typed-client call at the Zod validation step.
      expect('period' in validAdminStats).toBe(false);
      expect(AdminUsageStatsSchema.safeParse(validAdminStats).success).toBe(true);
    });

    it('should reject missing timeframe field', () => {
      const { timeframe: _unused, ...withoutTimeframe } = validAdminStats;
      expect(AdminUsageStatsSchema.safeParse(withoutTimeframe).success).toBe(false);
    });

    it('should reject missing uniqueUsers field', () => {
      const { uniqueUsers: _unused, ...withoutUniqueUsers } = validAdminStats;
      expect(AdminUsageStatsSchema.safeParse(withoutUniqueUsers).success).toBe(false);
    });

    it('should reject missing topUsers field', () => {
      const { topUsers: _unused, ...withoutTopUsers } = validAdminStats;
      expect(AdminUsageStatsSchema.safeParse(withoutTopUsers).success).toBe(false);
    });

    it('should reject negative uniqueUsers count', () => {
      const data = { ...validAdminStats, uniqueUsers: -1 };
      expect(AdminUsageStatsSchema.safeParse(data).success).toBe(false);
    });

    it('should reject invalid topUsers entry', () => {
      const data = { ...validAdminStats, topUsers: [{ discordId: '1', requests: -1, tokens: 0 }] };
      expect(AdminUsageStatsSchema.safeParse(data).success).toBe(false);
    });
  });
});
