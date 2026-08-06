import { describe, it, expect, vi, afterEach } from 'vitest';
import { rawOptionValue, parseIntFlag, parseIntFlagOrReport } from './cli-args.js';

describe('rawOptionValue', () => {
  it('reads a space-separated flag value verbatim (no numeric coercion)', () => {
    const argv = ['node', 'ops', 'cache:prefix-diff', '--channel', '123456789012345678'];
    // The whole point: the exact digits survive, where cac would deliver
    // 123456789012345680 (precision lost past MAX_SAFE_INTEGER).
    expect(rawOptionValue(argv, '--channel')).toBe('123456789012345678');
  });

  it('reads an equals-form flag value', () => {
    expect(rawOptionValue(['--channel=123456789012345678'], '--channel')).toBe(
      '123456789012345678'
    );
  });

  it('returns undefined for an absent flag', () => {
    expect(rawOptionValue(['--other', 'x'], '--channel')).toBeUndefined();
  });

  it('returns undefined when the flag has no value token', () => {
    expect(rawOptionValue(['--channel'], '--channel')).toBeUndefined();
    expect(rawOptionValue(['--channel', '--next-flag'], '--channel')).toBeUndefined();
  });

  it('does not match a flag that only shares a prefix', () => {
    expect(rawOptionValue(['--channel-id', '123'], '--channel')).toBeUndefined();
  });
});

describe('parseIntFlag', () => {
  it('returns the integer for a valid string value', () => {
    expect(parseIntFlag('7', '--limit', { min: 1 })).toBe(7);
  });

  it('accepts a number, since cac coerces digit-only values at tokenize time', () => {
    expect(parseIntFlag(120, '--drain-timeout', { min: 1 })).toBe(120);
  });

  it('returns undefined for an absent flag, keeping optional flags optional', () => {
    expect(parseIntFlag(undefined, '--limit', { min: 1 })).toBeUndefined();
  });

  it('rejects a non-numeric value, naming the flag', () => {
    // The core failure this helper exists to stop: `Number('abc')` is NaN and
    // every downstream comparison against it is false, so the typo'd flag
    // would silently ignore itself instead of erroring.
    expect(() => parseIntFlag('abc', '--limit', { min: 1 })).toThrow(
      '--limit must be an integer, got: "abc"'
    );
  });

  it('rejects a float', () => {
    expect(() => parseIntFlag('2.5', '--window-size', { min: 1 })).toThrow(
      '--window-size must be an integer, got: "2.5"'
    );
  });

  it('rejects an empty value, which `Number("")` would otherwise read as 0', () => {
    expect(() => parseIntFlag('', '--limit', { min: 1 })).toThrow('--limit must be an integer');
    expect(() => parseIntFlag('   ', '--limit', { min: 1 })).toThrow('--limit must be an integer');
  });

  it('rejects Infinity, which is numeric but not an integer', () => {
    expect(() => parseIntFlag('Infinity', '--limit', { min: 1 })).toThrow(
      '--limit must be an integer'
    );
  });

  it('rejects a negative value against a positive-integer floor', () => {
    expect(() => parseIntFlag('-3', '--count', { min: 1 })).toThrow(
      '--count must be at least 1, got: -3'
    );
  });

  it('rejects zero against a positive-integer floor', () => {
    expect(() => parseIntFlag('0', '--count', { min: 1 })).toThrow('--count must be at least 1');
  });

  it('rejects a value above the maximum, naming the cap', () => {
    expect(() => parseIntFlag('101', '--limit', { min: 1, max: 100 })).toThrow(
      '--limit must be at most 100, got: 101'
    );
  });

  it('accepts the inclusive bounds themselves', () => {
    expect(parseIntFlag('1', '--limit', { min: 1, max: 100 })).toBe(1);
    expect(parseIntFlag('100', '--limit', { min: 1, max: 100 })).toBe(100);
  });

  // `Number` reads all of these as integers, so an isInteger-only check would
  // accept them and quietly use a value the operator never typed.
  it.each([
    ['scientific notation', '1e2'],
    ['hexadecimal', '0x10'],
    ['binary', '0b11'],
    ['octal', '0o17'],
    ['a leading plus', '+5'],
  ])('rejects %s, which Number() would silently coerce to an integer', (_label, input) => {
    expect(() => parseIntFlag(input, '--limit', { min: 1 })).toThrow('--limit must be an integer');
  });

  it('echoes the verbatim input in a range message, not the coerced value', () => {
    // `007` coerces to 7; reporting "got: 7" would show the operator a number
    // they never typed, which is the harder thing to spot in a shell history.
    expect(() => parseIntFlag('007', '--limit', { min: 10 })).toThrow(
      '--limit must be at least 10, got: 007'
    );
  });

  it('rejects a decimal integer too large to represent exactly', () => {
    // Passes the shape check and `Number.isInteger`, but rounds on coercion —
    // accepting it would silently use a different number than was typed.
    expect(() => parseIntFlag('99999999999999999999', '--limit', { min: 1 })).toThrow(
      '--limit is too large to represent exactly'
    );
  });

  it('accepts MAX_SAFE_INTEGER itself', () => {
    expect(parseIntFlag(String(Number.MAX_SAFE_INTEGER), '--limit', { min: 1 })).toBe(
      Number.MAX_SAFE_INTEGER
    );
  });

  it('still accepts a value cac already coerced to a number', () => {
    // cac number-coerces digit-only option values at tokenize time, so the
    // shape check has to pass for a real `number` arrival, not just a string.
    expect(parseIntFlag(42, '--limit', { min: 1 })).toBe(42);
  });
});

describe('parseIntFlagOrReport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('returns the parsed value and leaves exitCode alone when valid', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseIntFlagOrReport('42', '--limit', { min: 1 })).toBe(42);
    expect(err).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('distinguishes an absent flag (undefined) from an invalid one (null)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The distinction callers depend on: undefined means "fall back to the
    // default", null means "abort" — collapsing them would run an invalid
    // flag under the default.
    expect(parseIntFlagOrReport(undefined, '--limit', { min: 1 })).toBeUndefined();
    expect(err).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();

    expect(parseIntFlagOrReport('abc', '--limit', { min: 1 })).toBeNull();
    expect(process.exitCode).toBe(1);
  });

  it('prints the flag-named message and sets exitCode on an invalid value', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseIntFlagOrReport('0', '--count', { min: 1 })).toBeNull();
    expect(err).toHaveBeenCalledWith('--count must be at least 1, got: 0');
    expect(process.exitCode).toBe(1);
  });

  it('reports an out-of-range value against a ceiling', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseIntFlagOrReport('101', '--limit', { min: 1, max: 100 })).toBeNull();
    expect(err).toHaveBeenCalledWith('--limit must be at most 100, got: 101');
  });
});
