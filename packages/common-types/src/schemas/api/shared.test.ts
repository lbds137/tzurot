/**
 * Tests for shared Zod utilities
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { emptyToUndefined, emptyToNull, optionalString, nullableString } from './shared.js';

describe('emptyToUndefined', () => {
  // IMPORTANT: Use with `.optional()` INSIDE the preprocess, not outside
  // This uses a union to accept either undefined or valid string
  const schema = emptyToUndefined(z.union([z.undefined(), z.string().min(1)]));

  it('should convert empty string to undefined', () => {
    const result = schema.safeParse('');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeUndefined();
    }
  });

  it('should convert whitespace-only string to undefined', () => {
    const result = schema.safeParse('   ');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeUndefined();
    }
  });

  it('should trim and keep valid strings', () => {
    const result = schema.safeParse('  hello  ');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('hello');
    }
  });

  it('should pass through non-string values', () => {
    const numSchema = emptyToUndefined(z.number().optional());
    const result = numSchema.safeParse(42);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(42);
    }
  });

  it('should handle undefined input', () => {
    const result = schema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeUndefined();
    }
  });
});

describe('emptyToNull', () => {
  // IMPORTANT: Use with `.nullable()` INSIDE the preprocess, not outside
  // This uses a union to accept either null or valid string
  const schema = emptyToNull(z.union([z.null(), z.string()]));

  it('should convert empty string to null', () => {
    const result = schema.safeParse('');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it('should convert whitespace-only string to null', () => {
    const result = schema.safeParse('   ');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it('should trim and keep valid strings', () => {
    const result = schema.safeParse('  description  ');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('description');
    }
  });

  it('should preserve explicit null input', () => {
    const result = schema.safeParse(null);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });
});

describe('optionalString', () => {
  const schema = z.object({
    name: optionalString(50),
  });

  it('should accept valid string', () => {
    const result = schema.safeParse({ name: 'test' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('test');
    }
  });

  it('should convert empty to undefined', () => {
    const result = schema.safeParse({ name: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBeUndefined();
    }
  });

  it('should allow missing field', () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBeUndefined();
    }
  });

  it('should enforce max length', () => {
    const result = schema.safeParse({ name: 'a'.repeat(51) });
    expect(result.success).toBe(false);
  });

  it('should enforce min length for non-empty strings', () => {
    // This tests that we can't bypass min(1) by having one char after trim
    const result = optionalString(10).safeParse('a');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('a');
    }
  });

  it('should convert non-string values to undefined for safety', () => {
    // Numbers, objects, arrays should not cause confusing validation errors
    expect(optionalString(10).safeParse(42).data).toBeUndefined();
    expect(optionalString(10).safeParse({ foo: 'bar' }).data).toBeUndefined();
    expect(optionalString(10).safeParse(['a', 'b']).data).toBeUndefined();
    expect(optionalString(10).safeParse(true).data).toBeUndefined();
  });
});

describe('nullableString', () => {
  const schema = z.object({
    description: nullableString(100),
  });

  it('should accept valid string', () => {
    const result = schema.safeParse({ description: 'test' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe('test');
    }
  });

  it('should convert empty to null', () => {
    const result = schema.safeParse({ description: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
    }
  });

  it('should allow explicit null', () => {
    const result = schema.safeParse({ description: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
    }
  });

  it('should allow missing field', () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
    }
  });

  it('should enforce max length', () => {
    const result = schema.safeParse({ description: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('should convert non-string values to undefined for safety', () => {
    // Non-string values become undefined (don't update) rather than null (clear)
    // This prevents accidental field clearing from malformed input
    expect(nullableString(100).safeParse(42).data).toBeUndefined();
    expect(nullableString(100).safeParse({ foo: 'bar' }).data).toBeUndefined();
    expect(nullableString(100).safeParse(['a', 'b']).data).toBeUndefined();
    expect(nullableString(100).safeParse(true).data).toBeUndefined();
  });
});

describe('integration: API update schema pattern', () => {
  // This tests the actual use case: updating an entity with optional fields
  const UpdateSchema = z.object({
    name: optionalString(100), // Required field in DB, but optional in update
    description: nullableString(500), // Nullable field in DB
    model: optionalString(200), // Required field in DB
  });

  it('should handle clearing all fields (empty strings)', () => {
    const input = { name: '', description: '', model: '' };
    const result = UpdateSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      // Empty required fields → undefined (don't update)
      expect(result.data.name).toBeUndefined();
      expect(result.data.model).toBeUndefined();
      // Empty nullable field → null (update to null)
      expect(result.data.description).toBeNull();
    }
  });

  it('should handle partial update with some empty fields', () => {
    const input = { name: 'New Name', description: '', model: '' };
    const result = UpdateSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('New Name');
      expect(result.data.description).toBeNull();
      expect(result.data.model).toBeUndefined();
    }
  });

  it('should handle full update with all valid values', () => {
    const input = {
      name: 'My Preset',
      description: 'A cool preset',
      model: 'anthropic/claude-sonnet-4',
    };
    const result = UpdateSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(input);
    }
  });
});
