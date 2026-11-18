import { describe, it, expect } from 'vitest';
import { parseFiniteNumber } from './catalogNumber.js';

describe('parseFiniteNumber', () => {
  it('parses decimal, signed, leading-dot, trailing-dot and exponent strings', () => {
    expect(parseFiniteNumber('0.1')).toBeCloseTo(0.1, 10);
    expect(parseFiniteNumber('+0.5')).toBeCloseTo(0.5, 10);
    expect(parseFiniteNumber('-2.5')).toBeCloseTo(-2.5, 10);
    expect(parseFiniteNumber('.5')).toBeCloseTo(0.5, 10);
    expect(parseFiniteNumber('1.')).toBe(1);
    expect(parseFiniteNumber('1E-6')).toBeCloseTo(1e-6, 12);
  });

  it('parses a padded decimal string', () => {
    expect(parseFiniteNumber(' 0.1 ')).toBeCloseTo(0.1, 10);
  });

  it.each([
    ['0x10', '0x10'],
    ['0b11', '0b11'],
    ['0o7', '0o7'],
    ['0.1abc', '0.1abc'],
    ['abc', 'abc'],
    ['empty string', ''],
    ['Infinity string', 'Infinity'],
    ['NaN', Number.NaN],
    ['null', null],
    ['undefined', undefined],
    ['object', {}],
  ])('returns undefined for %s', (_label, input) => {
    expect(parseFiniteNumber(input)).toBeUndefined();
  });

  it('passes a finite number through', () => {
    expect(parseFiniteNumber(0)).toBe(0);
    expect(parseFiniteNumber(0.25)).toBe(0.25);
    expect(parseFiniteNumber(-1)).toBe(-1);
  });
});
