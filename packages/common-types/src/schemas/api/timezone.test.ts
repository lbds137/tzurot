/**
 * Timezone API Contract Tests
 *
 * Validates schemas for /user/timezone endpoints.
 */

import { describe, it, expect } from 'vitest';
import {
  GetTimezoneResponseSchema,
  SetTimezoneResponseSchema,
  SetTimezoneInputSchema,
} from './timezone.js';

describe('Timezone API Contract Tests', () => {
  describe('GetTimezoneResponseSchema', () => {
    it('should accept valid response with custom timezone', () => {
      const data = { timezone: 'America/New_York', isDefault: false };
      const result = GetTimezoneResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept valid response with default timezone', () => {
      const data = { timezone: 'UTC', isDefault: true };
      const result = GetTimezoneResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing timezone', () => {
      const data = { isDefault: true };
      const result = GetTimezoneResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing isDefault', () => {
      const data = { timezone: 'UTC' };
      const result = GetTimezoneResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('SetTimezoneResponseSchema', () => {
    it('should accept valid set response', () => {
      const data = {
        success: true as const,
        timezone: 'America/New_York',
        label: 'Eastern Time',
        offset: 'UTC-5',
      };
      const result = SetTimezoneResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject success=false', () => {
      const data = {
        success: false,
        timezone: 'UTC',
        label: 'UTC',
        offset: 'UTC+0',
      };
      const result = SetTimezoneResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing label', () => {
      const data = {
        success: true as const,
        timezone: 'UTC',
        offset: 'UTC+0',
      };
      const result = SetTimezoneResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing offset', () => {
      const data = {
        success: true as const,
        timezone: 'UTC',
        label: 'UTC',
      };
      const result = SetTimezoneResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('SetTimezoneInputSchema', () => {
    it('should accept valid timezone string', () => {
      const result = SetTimezoneInputSchema.safeParse({ timezone: 'America/New_York' });
      expect(result.success).toBe(true);
    });

    it('should reject empty timezone', () => {
      const result = SetTimezoneInputSchema.safeParse({ timezone: '' });
      expect(result.success).toBe(false);
    });

    it('should reject missing timezone', () => {
      const result = SetTimezoneInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
