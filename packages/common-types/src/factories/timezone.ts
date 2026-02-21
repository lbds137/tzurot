/**
 * Validated Mock Factories for Timezone API Endpoints
 *
 * These factories create mock data that is VALIDATED against Zod schemas.
 * If a test tries to mock an invalid shape, the test will CRASH immediately.
 *
 * Usage:
 *   import { mockGetTimezoneResponse } from '@tzurot/common-types/factories';
 *   mockCallGatewayApi.mockResolvedValue({
 *     ok: true,
 *     data: mockGetTimezoneResponse({ timezone: 'America/New_York' }),
 *   });
 */

import {
  GetTimezoneResponseSchema,
  SetTimezoneResponseSchema,
  type GetTimezoneResponse,
  type SetTimezoneResponse,
} from '../schemas/api/timezone.js';

import { type DeepPartial } from './factoryUtils.js';

// ============================================================================
// GET /user/timezone
// ============================================================================

const defaultGetTimezoneResponse: GetTimezoneResponse = {
  timezone: 'UTC',
  isDefault: true,
};

/**
 * Create a validated mock for GET /user/timezone response
 * @param overrides - Partial overrides for the default response
 * @returns Validated GetTimezoneResponse
 * @throws ZodError if the resulting object doesn't match the schema
 */
export function mockGetTimezoneResponse(
  overrides: DeepPartial<GetTimezoneResponse> = {}
): GetTimezoneResponse {
  const merged: GetTimezoneResponse = {
    ...defaultGetTimezoneResponse,
    ...overrides,
  };
  return GetTimezoneResponseSchema.parse(merged);
}

// ============================================================================
// PUT /user/timezone
// ============================================================================

const defaultSetTimezoneResponse: SetTimezoneResponse = {
  success: true,
  timezone: 'America/New_York',
  label: 'Eastern Time (US & Canada)',
  offset: 'UTC-05:00',
};

/**
 * Create a validated mock for PUT /user/timezone response
 * @param overrides - Partial overrides for the default response
 * @returns Validated SetTimezoneResponse
 * @throws ZodError if the resulting object doesn't match the schema
 */
export function mockSetTimezoneResponse(
  overrides: DeepPartial<SetTimezoneResponse> = {}
): SetTimezoneResponse {
  const merged: SetTimezoneResponse = {
    ...defaultSetTimezoneResponse,
    // success must always be true (literal)
    success: true,
    ...overrides,
  };
  return SetTimezoneResponseSchema.parse(merged);
}
