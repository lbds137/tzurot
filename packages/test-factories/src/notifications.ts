/**
 * Validated Mock Factories for Notification-Preference API Endpoints
 *
 * These factories create mock data that is VALIDATED against Zod schemas.
 * If a test tries to mock an invalid shape, the test will CRASH immediately.
 *
 * Usage:
 *   import { mockGetNotificationPrefsResponse } from '@tzurot/common-types/factories';
 *   stub.getNotificationPrefs.mockResolvedValue({
 *     ok: true,
 *     data: mockGetNotificationPrefsResponse({ level: 'patch' }),
 *   });
 */

import {
  GetNotificationPrefsResponseSchema,
  UpdateNotificationPrefsResponseSchema,
  type GetNotificationPrefsResponse,
  type UpdateNotificationPrefsResponse,
} from '@tzurot/common-types/schemas/api/notifications';
import { type DeepPartial } from './factoryUtils.js';

// ============================================================================
// GET /user/notifications
// ============================================================================

const defaultGetNotificationPrefsResponse: GetNotificationPrefsResponse = {
  enabled: true,
  level: 'minor',
};

/**
 * Create a validated mock for GET /user/notifications response
 * @param overrides - Partial overrides for the default response
 * @returns Validated GetNotificationPrefsResponse
 * @throws ZodError if the resulting object doesn't match the schema
 */
export function mockGetNotificationPrefsResponse(
  overrides: DeepPartial<GetNotificationPrefsResponse> = {}
): GetNotificationPrefsResponse {
  const merged: GetNotificationPrefsResponse = {
    ...defaultGetNotificationPrefsResponse,
    ...overrides,
  };
  return GetNotificationPrefsResponseSchema.parse(merged);
}

// ============================================================================
// PATCH /user/notifications
// ============================================================================

const defaultUpdateNotificationPrefsResponse: UpdateNotificationPrefsResponse = {
  success: true,
  enabled: true,
  level: 'minor',
};

/**
 * Create a validated mock for PATCH /user/notifications response
 * @param overrides - Partial overrides for the default response
 * @returns Validated UpdateNotificationPrefsResponse
 * @throws ZodError if the resulting object doesn't match the schema
 */
export function mockUpdateNotificationPrefsResponse(
  overrides: DeepPartial<UpdateNotificationPrefsResponse> = {}
): UpdateNotificationPrefsResponse {
  const merged: UpdateNotificationPrefsResponse = {
    ...defaultUpdateNotificationPrefsResponse,
    // success must always be true (literal)
    success: true,
    ...overrides,
  };
  return UpdateNotificationPrefsResponseSchema.parse(merged);
}
