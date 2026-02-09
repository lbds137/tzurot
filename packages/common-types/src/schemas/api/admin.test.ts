/**
 * Admin API Input Schema Tests
 *
 * Validates schemas for admin endpoint request bodies.
 */

import { describe, it, expect } from 'vitest';
import { InvalidateCacheSchema, DbSyncSchema, DiagnosticUpdateSchema } from './admin.js';

describe('Admin API Input Schema Tests', () => {
  describe('InvalidateCacheSchema', () => {
    it('should accept all: true', () => {
      const result = InvalidateCacheSchema.safeParse({ all: true });
      expect(result.success).toBe(true);
    });

    it('should accept valid personalityId', () => {
      const result = InvalidateCacheSchema.safeParse({
        personalityId: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.success).toBe(true);
    });

    it('should accept both all and personalityId', () => {
      const result = InvalidateCacheSchema.safeParse({
        all: true,
        personalityId: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.success).toBe(true);
    });

    it('should default all to false', () => {
      const result = InvalidateCacheSchema.safeParse({
        personalityId: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.all).toBe(false);
      }
    });

    it('should reject empty body (neither all nor personalityId)', () => {
      const result = InvalidateCacheSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject all: false without personalityId', () => {
      const result = InvalidateCacheSchema.safeParse({ all: false });
      expect(result.success).toBe(false);
    });

    it('should reject non-UUID personalityId', () => {
      const result = InvalidateCacheSchema.safeParse({ personalityId: 'not-a-uuid' });
      expect(result.success).toBe(false);
    });
  });

  describe('DbSyncSchema', () => {
    it('should accept empty body (defaults dryRun to false)', () => {
      const result = DbSyncSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dryRun).toBe(false);
      }
    });

    it('should accept dryRun: true', () => {
      const result = DbSyncSchema.safeParse({ dryRun: true });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dryRun).toBe(true);
      }
    });

    it('should accept dryRun: false', () => {
      const result = DbSyncSchema.safeParse({ dryRun: false });
      expect(result.success).toBe(true);
    });

    it('should reject non-boolean dryRun', () => {
      const result = DbSyncSchema.safeParse({ dryRun: 'true' });
      expect(result.success).toBe(false);
    });
  });

  describe('DiagnosticUpdateSchema', () => {
    it('should accept valid string array', () => {
      const result = DiagnosticUpdateSchema.safeParse({
        responseMessageIds: ['msg-1', 'msg-2'],
      });
      expect(result.success).toBe(true);
    });

    it('should accept single-element array', () => {
      const result = DiagnosticUpdateSchema.safeParse({
        responseMessageIds: ['msg-1'],
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty array', () => {
      const result = DiagnosticUpdateSchema.safeParse({
        responseMessageIds: [],
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing responseMessageIds', () => {
      const result = DiagnosticUpdateSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject non-array', () => {
      const result = DiagnosticUpdateSchema.safeParse({
        responseMessageIds: 'not-an-array',
      });
      expect(result.success).toBe(false);
    });

    it('should reject array with empty strings', () => {
      const result = DiagnosticUpdateSchema.safeParse({
        responseMessageIds: ['msg-1', ''],
      });
      expect(result.success).toBe(false);
    });

    it('should reject array exceeding max length', () => {
      const result = DiagnosticUpdateSchema.safeParse({
        responseMessageIds: Array.from({ length: 101 }, (_, i) => `msg-${i}`),
      });
      expect(result.success).toBe(false);
    });

    it('should accept array at max length', () => {
      const result = DiagnosticUpdateSchema.safeParse({
        responseMessageIds: Array.from({ length: 100 }, (_, i) => `msg-${i}`),
      });
      expect(result.success).toBe(true);
    });
  });
});
