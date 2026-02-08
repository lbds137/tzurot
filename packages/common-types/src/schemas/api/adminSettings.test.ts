/**
 * Admin Settings API Contract Tests
 *
 * Validates schemas for /admin/settings endpoints.
 */

import { describe, it, expect } from 'vitest';
import { AdminSettingsSchema, ResolvedExtendedContextSettingsSchema } from './adminSettings.js';

describe('Admin Settings API Contract Tests', () => {
  describe('AdminSettingsSchema', () => {
    it('should accept valid admin settings', () => {
      const data = {
        id: '550e8400-e29b-41d4-a716-446655440001',
        updatedBy: '550e8400-e29b-41d4-a716-446655440002',
        createdAt: '2025-01-15T12:00:00.000Z',
        updatedAt: '2025-01-20T15:30:00.000Z',
      };
      const result = AdminSettingsSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept null updatedBy (never edited)', () => {
      const data = {
        id: '550e8400-e29b-41d4-a716-446655440001',
        updatedBy: null,
        createdAt: '2025-01-15T12:00:00.000Z',
        updatedAt: '2025-01-15T12:00:00.000Z',
      };
      const result = AdminSettingsSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID for id', () => {
      const data = {
        id: 'not-a-uuid',
        updatedBy: null,
        createdAt: '2025-01-15T12:00:00.000Z',
        updatedAt: '2025-01-15T12:00:00.000Z',
      };
      const result = AdminSettingsSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const result = AdminSettingsSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('ResolvedExtendedContextSettingsSchema', () => {
    it('should accept valid resolved settings', () => {
      const data = {
        maxMessages: 20,
        maxAge: 3600,
        maxImages: 5,
        sources: {
          maxMessages: 'personality',
          maxAge: 'user-personality',
          maxImages: 'user-default',
        },
      };
      const result = ResolvedExtendedContextSettingsSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept null maxAge (disabled)', () => {
      const data = {
        maxMessages: 10,
        maxAge: null,
        maxImages: 3,
        sources: {
          maxMessages: 'user-default',
          maxAge: 'personality',
          maxImages: 'personality',
        },
      };
      const result = ResolvedExtendedContextSettingsSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept all source types', () => {
      for (const source of ['personality', 'user-personality', 'user-default'] as const) {
        const data = {
          maxMessages: 10,
          maxAge: null,
          maxImages: 3,
          sources: {
            maxMessages: source,
            maxAge: source,
            maxImages: source,
          },
        };
        const result = ResolvedExtendedContextSettingsSchema.safeParse(data);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid source type', () => {
      const data = {
        maxMessages: 10,
        maxAge: null,
        maxImages: 3,
        sources: {
          maxMessages: 'invalid-source',
          maxAge: 'personality',
          maxImages: 'personality',
        },
      };
      const result = ResolvedExtendedContextSettingsSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject non-integer maxMessages', () => {
      const data = {
        maxMessages: 10.5,
        maxAge: null,
        maxImages: 3,
        sources: {
          maxMessages: 'personality',
          maxAge: 'personality',
          maxImages: 'personality',
        },
      };
      const result = ResolvedExtendedContextSettingsSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing sources', () => {
      const data = {
        maxMessages: 10,
        maxAge: null,
        maxImages: 3,
      };
      const result = ResolvedExtendedContextSettingsSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });
});
