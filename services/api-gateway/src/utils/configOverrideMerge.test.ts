import { describe, it, expect } from 'vitest';
import { mergeConfigOverrides } from './configOverrideMerge.js';

describe('mergeConfigOverrides', () => {
  it('should merge valid input with empty existing', () => {
    const result = mergeConfigOverrides(null, { maxMessages: 25 });
    expect(result).toEqual({ maxMessages: 25 });
  });

  it('should merge valid input with existing values', () => {
    const existing = { maxMessages: 50, maxImages: 5 };
    const result = mergeConfigOverrides(existing, { maxMessages: 25 });
    expect(result).toEqual({ maxMessages: 25, maxImages: 5 });
  });

  it('should return "invalid" for invalid input', () => {
    const result = mergeConfigOverrides(null, { maxMessages: 'not-a-number' });
    expect(result).toBe('invalid');
  });

  it('should return "invalid" for unknown keys (strict schema)', () => {
    const result = mergeConfigOverrides(null, { unknownField: true });
    expect(result).toBe('invalid');
  });

  it('should strip null fields inherited from existing JSONB', () => {
    // Existing JSONB may contain nulls from prior clears; they get cleaned on merge
    const existing = { maxMessages: 50, maxImages: null };
    const result = mergeConfigOverrides(existing, { memoryLimit: 10 });
    expect(result).toEqual({ maxMessages: 50, memoryLimit: 10 });
  });

  it('should strip undefined fields inherited from existing JSONB', () => {
    const existing = { maxMessages: 50, maxImages: undefined };
    const result = mergeConfigOverrides(existing, { memoryLimit: 10 });
    expect(result).toEqual({ maxMessages: 50, memoryLimit: 10 });
  });

  it('should return null when merge result is empty', () => {
    const result = mergeConfigOverrides(null, {});
    expect(result).toBeNull();
  });

  it('should treat non-object existing as empty', () => {
    const result = mergeConfigOverrides('not-an-object', { maxMessages: 10 });
    expect(result).toEqual({ maxMessages: 10 });
  });

  it('should treat array existing as empty', () => {
    const result = mergeConfigOverrides([1, 2, 3], { maxImages: 3 });
    expect(result).toEqual({ maxImages: 3 });
  });

  it('should treat null input values as "clear override" (removes key from merged result)', () => {
    const existing = { maxMessages: 50, crossChannelHistoryEnabled: true };
    const result = mergeConfigOverrides(existing, { crossChannelHistoryEnabled: null });
    // null → undefined → stripped from merged result
    expect(result).toEqual({ maxMessages: 50 });
  });

  it('should clear boolean override back to inherited when null is sent', () => {
    const existing = { shareLtmAcrossPersonalities: true, maxImages: 5 };
    const result = mergeConfigOverrides(existing, { shareLtmAcrossPersonalities: null });
    expect(result).toEqual({ maxImages: 5 });
  });

  it('should return null when clearing the only existing override', () => {
    const existing = { crossChannelHistoryEnabled: true };
    const result = mergeConfigOverrides(existing, { crossChannelHistoryEnabled: null });
    expect(result).toBeNull();
  });

  it('should handle multiple fields', () => {
    const existing = { maxMessages: 50, memoryLimit: 20 };
    const result = mergeConfigOverrides(existing, {
      maxMessages: 30,
      maxImages: 5,
      focusModeEnabled: true,
    });
    expect(result).toEqual({
      maxMessages: 30,
      maxImages: 5,
      memoryLimit: 20,
      focusModeEnabled: true,
    });
  });
});
