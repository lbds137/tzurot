/**
 * Tests for Prisma Error Utilities
 */

import { describe, it, expect } from 'vitest';
import { isPrismaUniqueConstraintError, isPrismaUniqueConstraintErrorOn } from './prismaErrors.js';

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

describe('isPrismaUniqueConstraintErrorOn', () => {
  it('returns true when target includes all required columns', () => {
    const err = { code: 'P2002', meta: { target: ['owner_id', 'name'] } };
    expect(isPrismaUniqueConstraintErrorOn(err, ['owner_id', 'name'])).toBe(true);
  });

  it('returns true when target includes required columns and extras', () => {
    const err = { code: 'P2002', meta: { target: ['owner_id', 'name', 'tenant_id'] } };
    expect(isPrismaUniqueConstraintErrorOn(err, ['owner_id', 'name'])).toBe(true);
  });

  it('returns false when target is missing a required column', () => {
    const err = { code: 'P2002', meta: { target: ['owner_id'] } };
    expect(isPrismaUniqueConstraintErrorOn(err, ['owner_id', 'name'])).toBe(false);
  });

  it('returns false when target is the PK only (id)', () => {
    // The motivating case: a hypothetical UUIDv7 PK collision must NOT be
    // confused with an owner_id/name collision in the auto-suffix path.
    const err = { code: 'P2002', meta: { target: ['id'] } };
    expect(isPrismaUniqueConstraintErrorOn(err, ['owner_id', 'name'])).toBe(false);
  });

  it('returns false when error is not P2002', () => {
    const err = { code: 'P2025', meta: { target: ['owner_id', 'name'] } };
    expect(isPrismaUniqueConstraintErrorOn(err, ['owner_id', 'name'])).toBe(false);
  });

  it('returns false when meta is missing', () => {
    expect(isPrismaUniqueConstraintErrorOn({ code: 'P2002' }, ['owner_id'])).toBe(false);
  });

  it('returns false when meta.target is missing', () => {
    expect(isPrismaUniqueConstraintErrorOn({ code: 'P2002', meta: {} }, ['owner_id'])).toBe(false);
  });

  it('returns false when meta.target is not an array', () => {
    const err = { code: 'P2002', meta: { target: 'owner_id_name' } };
    expect(isPrismaUniqueConstraintErrorOn(err, ['owner_id', 'name'])).toBe(false);
  });

  it('returns false for null / undefined', () => {
    expect(isPrismaUniqueConstraintErrorOn(null, ['owner_id'])).toBe(false);
    expect(isPrismaUniqueConstraintErrorOn(undefined, ['owner_id'])).toBe(false);
  });
});
