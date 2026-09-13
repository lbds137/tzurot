import { describe, it, expect } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { toNullableJsonInput } from './prismaJsonInput.js';

describe('toNullableJsonInput', () => {
  it('returns undefined for undefined (omit the field)', () => {
    expect(toNullableJsonInput(undefined)).toBeUndefined();
  });

  it('returns Prisma.DbNull for null (clear the column)', () => {
    expect(toNullableJsonInput(null)).toBe(Prisma.DbNull);
  });

  it('returns the same object for an object value (stored as-is)', () => {
    const value = { theme: 'dark' };
    expect(toNullableJsonInput(value)).toBe(value);
    expect(toNullableJsonInput(value)).toEqual({ theme: 'dark' });
  });
});
