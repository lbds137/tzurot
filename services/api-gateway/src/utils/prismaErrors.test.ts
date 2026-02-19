/**
 * Tests for Prisma Error Utilities
 */

import { describe, it, expect } from 'vitest';
import { isPrismaUniqueConstraintError } from './prismaErrors.js';

describe('isPrismaUniqueConstraintError', () => {
  it('should return true for P2002 error objects', () => {
    expect(isPrismaUniqueConstraintError({ code: 'P2002' })).toBe(true);
  });

  it('should return false for other Prisma error codes', () => {
    expect(isPrismaUniqueConstraintError({ code: 'P2025' })).toBe(false);
  });

  it('should return false for null', () => {
    expect(isPrismaUniqueConstraintError(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isPrismaUniqueConstraintError(undefined)).toBe(false);
  });

  it('should return false for strings', () => {
    expect(isPrismaUniqueConstraintError('P2002')).toBe(false);
  });

  it('should return false for objects without code property', () => {
    expect(isPrismaUniqueConstraintError({ message: 'error' })).toBe(false);
  });

  it('should return false for plain Error instances', () => {
    expect(isPrismaUniqueConstraintError(new Error('P2002'))).toBe(false);
  });
});
