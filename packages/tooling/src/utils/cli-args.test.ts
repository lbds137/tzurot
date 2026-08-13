import { cac } from 'cac';
import { describe, it, expect } from 'vitest';
import { rawOptionValue, parseIntFlag } from './cli-args.js';
import { UsageError } from './errors.js';

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

  it('refuses a repeated flag rather than picking one occurrence', () => {
    expect(() => rawOptionValue(['--channel', 'aaa', '--channel', 'bbb'], '--channel')).toThrow(
      UsageError
    );
    // The message names the flag and the count, so the operator can see which
    // of their own arguments to drop.
    expect(() => rawOptionValue(['--channel', 'aaa', '--channel', 'bbb'], '--channel')).toThrow(
      '--channel was given 2 times'
    );
  });

  it('refuses a repeat spelled two different ways, since cac sees one option', () => {
    expect(() => rawOptionValue(['--job-id', 'aaa', '--jobId', 'bbb'], '--job-id')).toThrow(
      UsageError
    );
  });

  it('refuses a repeat in the equals form', () => {
    expect(() => rawOptionValue(['--channel=aaa', '--channel=bbb'], '--channel')).toThrow(
      UsageError
    );
  });

  it('refuses a mixed-spelling repeat in the equals form', () => {
    // The two forms are matched by separate branches, so the space-form
    // mixed-spelling case above does not cover this one.
    expect(() => rawOptionValue(['--job-id=aaa', '--jobId=bbb'], '--job-id')).toThrow(UsageError);
  });

  it('would silently narrow an --exclude list if repeats were tolerated', () => {
    // Pins the docblock's claim about cac rather than asserting it in prose:
    // cac collects every occurrence into an array, so a first-occurrence-wins
    // raw scan disagrees with the parser. On retention:purge that disagreement
    // drops protected ids from an irreversible run, so this refuses instead.
    const cli = cac('test');
    let parsed: unknown;
    cli
      .command('probe')
      .option('--exclude <ids>', 'test flag')
      .action((options: { exclude?: unknown }) => {
        parsed = options.exclude;
      });
    cli.parse(['node', 'test', 'probe', '--exclude', 'aaa', '--exclude', 'bbb'], { run: true });

    expect(parsed).toEqual(['aaa', 'bbb']);
    expect(() => rawOptionValue(['--exclude', 'aaa', '--exclude', 'bbb'], '--exclude')).toThrow(
      UsageError
    );
  });

  it('reads the camelCase spelling cac accepts for a kebab-case flag', () => {
    // cac normalizes both spellings to the same option, so a scan that only
    // knew the kebab token would run unfiltered on a --jobId dig while the
    // command still reported success.
    expect(rawOptionValue(['--jobId', '123456789012345678'], '--job-id')).toBe(
      '123456789012345678'
    );
    expect(rawOptionValue(['--jobId=123456789012345678'], '--job-id')).toBe('123456789012345678');
  });

  it('parses both spellings of a kebab flag to one cac option', () => {
    // The premise of the case above, pinned against the real parser rather
    // than restated in a comment.
    const parse = (arg: string): unknown => {
      const cli = cac('test');
      let parsed: unknown;
      cli
        .command('probe')
        .option('--job-id <id>', 'test flag')
        .action((options: { jobId?: unknown }) => {
          parsed = options.jobId;
        });
      cli.parse(['node', 'test', 'probe', arg, 'abc'], { run: true });
      return parsed;
    };

    expect(parse('--job-id')).toBe('abc');
    expect(parse('--jobId')).toBe('abc');
  });

  it('reads a hyphen-free flag unchanged, whose camelCase spelling is itself', () => {
    // Regression guard on the alias change rather than on a double-count risk:
    // the scan tests argv elements for membership, so a spelling listed twice
    // still matches once per argument (canaried — an array behaves the same).
    expect(rawOptionValue(['--channel', 'aaa'], '--channel')).toBe('aaa');
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

  // The CLASS is load-bearing, not just the message text: cli.ts's top-level
  // handler keys on `UsageError` to print one line instead of a stack trace
  // and a Node version banner, so a bare `Error` here would regress the
  // operator-facing output while every message assertion above still passed.
  // One case per throw branch.
  it('throws UsageError, the tag the top-level handler renders as one line', () => {
    expect(() => parseIntFlag('abc', '--limit', { min: 1 })).toThrow(UsageError);
    expect(() => parseIntFlag('0', '--limit', { min: 1 })).toThrow(UsageError);
    expect(() => parseIntFlag('101', '--limit', { min: 1, max: 100 })).toThrow(UsageError);
    expect(() => parseIntFlag('99999999999999999999', '--limit', { min: 1 })).toThrow(UsageError);
  });
});
