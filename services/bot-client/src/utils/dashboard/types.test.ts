/**
 * Tests for Dashboard Types and Utilities
 */

import { describe, it, expect } from 'vitest';
import { resolveContextAware, type DashboardContext } from './types.js';

describe('resolveContextAware', () => {
  const adminContext: DashboardContext = { isAdmin: true, userId: 'admin-123' };
  const userContext: DashboardContext = { isAdmin: false, userId: 'user-456' };

  describe('with static values', () => {
    it('should return static boolean true', () => {
      expect(resolveContextAware(true, adminContext, false)).toBe(true);
      expect(resolveContextAware(true, userContext, false)).toBe(true);
    });

    it('should return static boolean false', () => {
      expect(resolveContextAware(false, adminContext, true)).toBe(false);
      expect(resolveContextAware(false, userContext, true)).toBe(false);
    });

    it('should return static string value', () => {
      expect(resolveContextAware('hello', adminContext, 'default')).toBe('hello');
    });

    it('should return static number value', () => {
      expect(resolveContextAware(42, adminContext, 0)).toBe(42);
    });
  });

  describe('with function values', () => {
    it('should call function with context and return result', () => {
      const fn = (ctx: DashboardContext) => ctx.isAdmin;
      expect(resolveContextAware(fn, adminContext, false)).toBe(true);
      expect(resolveContextAware(fn, userContext, false)).toBe(false);
    });

    it('should work with negation for hidden fields', () => {
      // This is the pattern used for admin-only fields: hidden when NOT admin
      const hiddenFromNonAdmin = (ctx: DashboardContext) => !ctx.isAdmin;
      expect(resolveContextAware(hiddenFromNonAdmin, adminContext, false)).toBe(false);
      expect(resolveContextAware(hiddenFromNonAdmin, userContext, false)).toBe(true);
    });

    it('should pass userId through context', () => {
      const fn = (ctx: DashboardContext) => ctx.userId;
      expect(resolveContextAware(fn, adminContext, '')).toBe('admin-123');
      expect(resolveContextAware(fn, userContext, '')).toBe('user-456');
    });
  });

  describe('with undefined values', () => {
    it('should return default when value is undefined', () => {
      expect(resolveContextAware(undefined, adminContext, true)).toBe(true);
      expect(resolveContextAware(undefined, adminContext, false)).toBe(false);
      expect(resolveContextAware(undefined, adminContext, 'default')).toBe('default');
    });
  });

  describe('edge cases', () => {
    it('should handle function returning undefined', () => {
      // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
      const fn = () => undefined as unknown as boolean;
      expect(resolveContextAware(fn, adminContext, true)).toBeUndefined();
    });

    it('should handle empty string default', () => {
      expect(resolveContextAware(undefined, adminContext, '')).toBe('');
    });

    it('should handle zero default', () => {
      expect(resolveContextAware(undefined, adminContext, 0)).toBe(0);
    });
  });
});
