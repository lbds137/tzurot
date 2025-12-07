/**
 * Validated Mock Factories for Usage API Endpoints
 *
 * These factories create mock data that is VALIDATED against Zod schemas.
 * If a test tries to mock an invalid shape, the test will CRASH immediately.
 *
 * Usage:
 *   import { mockGetUsageResponse } from '@tzurot/common-types/factories';
 *   mockCallGatewayApi.mockResolvedValue({
 *     ok: true,
 *     data: mockGetUsageResponse({ totalTokens: 5000 }),
 *   });
 */

import {
  GetUsageResponseSchema,
  UsageBreakdownSchema,
  type GetUsageResponse,
} from '../schemas/api/usage.js';
import { z } from 'zod';

type UsageBreakdown = z.infer<typeof UsageBreakdownSchema>;

// ============================================================================
// Type Utilities
// ============================================================================

type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

// ============================================================================
// Shared Helpers
// ============================================================================

const defaultUsageBreakdown: UsageBreakdown = {
  requests: 0,
  tokensIn: 0,
  tokensOut: 0,
};

/**
 * Create a validated usage breakdown
 */
export function mockUsageBreakdown(
  overrides: DeepPartial<UsageBreakdown> = {}
): UsageBreakdown {
  const merged: UsageBreakdown = {
    ...defaultUsageBreakdown,
    ...overrides,
  };
  return UsageBreakdownSchema.parse(merged);
}

// ============================================================================
// GET /user/usage
// ============================================================================

const defaultGetUsageResponse: GetUsageResponse = {
  period: 'month',
  periodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  periodEnd: new Date().toISOString(),
  totalRequests: 0,
  totalTokensIn: 0,
  totalTokensOut: 0,
  totalTokens: 0,
  byProvider: {},
  byModel: {},
  byRequestType: {},
};

/**
 * Create a validated mock for GET /user/usage response
 * @param overrides - Partial overrides for the default response
 * @returns Validated GetUsageResponse
 * @throws ZodError if the resulting object doesn't match the schema
 */
export function mockGetUsageResponse(
  overrides: DeepPartial<GetUsageResponse> = {}
): GetUsageResponse {
  // For records, we need to validate each breakdown
  const byProvider: Record<string, UsageBreakdown> = {};
  const byModel: Record<string, UsageBreakdown> = {};
  const byRequestType: Record<string, UsageBreakdown> = {};

  if (overrides.byProvider !== undefined) {
    for (const [key, value] of Object.entries(overrides.byProvider)) {
      if (value !== undefined) {
        byProvider[key] = mockUsageBreakdown(value);
      }
    }
  }

  if (overrides.byModel !== undefined) {
    for (const [key, value] of Object.entries(overrides.byModel)) {
      if (value !== undefined) {
        byModel[key] = mockUsageBreakdown(value);
      }
    }
  }

  if (overrides.byRequestType !== undefined) {
    for (const [key, value] of Object.entries(overrides.byRequestType)) {
      if (value !== undefined) {
        byRequestType[key] = mockUsageBreakdown(value);
      }
    }
  }

  const merged: GetUsageResponse = {
    ...defaultGetUsageResponse,
    ...overrides,
    byProvider: Object.keys(byProvider).length > 0 ? byProvider : defaultGetUsageResponse.byProvider,
    byModel: Object.keys(byModel).length > 0 ? byModel : defaultGetUsageResponse.byModel,
    byRequestType:
      Object.keys(byRequestType).length > 0 ? byRequestType : defaultGetUsageResponse.byRequestType,
  };

  return GetUsageResponseSchema.parse(merged);
}

/**
 * Create a mock usage response with sample data
 * Useful for testing display of usage statistics
 */
export function mockGetUsageResponseWithData(
  overrides: DeepPartial<GetUsageResponse> = {}
): GetUsageResponse {
  return mockGetUsageResponse({
    totalRequests: 42,
    totalTokensIn: 15000,
    totalTokensOut: 5000,
    totalTokens: 20000,
    byProvider: {
      openrouter: { requests: 42, tokensIn: 15000, tokensOut: 5000 },
    },
    byModel: {
      'openai/gpt-4o-mini': { requests: 30, tokensIn: 10000, tokensOut: 3500 },
      'anthropic/claude-3-haiku': { requests: 12, tokensIn: 5000, tokensOut: 1500 },
    },
    byRequestType: {
      chat: { requests: 40, tokensIn: 14000, tokensOut: 4800 },
      transcription: { requests: 2, tokensIn: 1000, tokensOut: 200 },
    },
    ...overrides,
  });
}
