import { describe, it, expect } from 'vitest';
import { rawOptionValue } from './cli-args.js';

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
