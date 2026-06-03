import { describe, it, expect } from 'vitest';
import { deepMerge, type DeepPartial } from './factoryUtils.js';

describe('deepMerge', () => {
  it('should return base when no overrides provided', () => {
    const base = { a: 1, b: 'hello' };
    expect(deepMerge(base)).toEqual(base);
  });

  it('should return base when overrides is undefined', () => {
    const base = { a: 1 };
    expect(deepMerge(base, undefined)).toEqual(base);
  });

  it('should override top-level properties', () => {
    const base = { a: 1, b: 2 };
    const result = deepMerge(base, { a: 10 });
    expect(result).toEqual({ a: 10, b: 2 });
  });

  it('should deep merge nested objects', () => {
    const base = { nested: { x: 1, y: 2 }, top: 'keep' };
    const result = deepMerge(base, { nested: { x: 99 } });
    expect(result).toEqual({ nested: { x: 99, y: 2 }, top: 'keep' });
  });

  it('should replace arrays entirely (no array merge)', () => {
    const base = { items: [1, 2, 3] };
    const result = deepMerge(base, { items: [4, 5] } as DeepPartial<typeof base>);
    expect(result).toEqual({ items: [4, 5] });
  });

  it('should handle null override values', () => {
    const base = { a: 'hello' as string | null };
    const result = deepMerge(base, { a: null });
    expect(result).toEqual({ a: null });
  });

  it('should skip undefined override values', () => {
    const base = { a: 1, b: 2 };
    const result = deepMerge(base, { a: undefined });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('should not mutate the base object', () => {
    const base = { nested: { x: 1 } };
    const baseCopy = JSON.parse(JSON.stringify(base));
    deepMerge(base, { nested: { x: 99 } });
    expect(base).toEqual(baseCopy);
  });

  it('should handle deeply nested objects', () => {
    const base = { a: { b: { c: { d: 1 } } } };
    const result = deepMerge(base, { a: { b: { c: { d: 42 } } } });
    expect(result).toEqual({ a: { b: { c: { d: 42 } } } });
  });

  it('should handle non-object base (primitive passthrough)', () => {
    expect(deepMerge(42 as unknown as object)).toBe(42);
  });
});
