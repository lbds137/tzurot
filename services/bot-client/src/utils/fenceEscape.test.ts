import { describe, it, expect } from 'vitest';
import { escapeFenceBreaks } from './fenceEscape.js';

describe('escapeFenceBreaks', () => {
  it('breaks a triple-backtick run so it cannot close a fence', () => {
    const result = escapeFenceBreaks('pasted ```js const x = 1``` code');
    expect(result).not.toContain('```');
    // Visible backticks survive (zero-width separators only)
    expect(result.replace(/\u200b/g, '')).toBe('pasted ```js const x = 1``` code');
  });

  it('breaks longer backtick runs too', () => {
    expect(escapeFenceBreaks('````')).not.toContain('```');
  });

  it('leaves inline code (single/double backticks) untouched', () => {
    expect(escapeFenceBreaks('has `inline` and ``double`` code')).toBe(
      'has `inline` and ``double`` code'
    );
  });

  it('passes through text without backticks unchanged', () => {
    expect(escapeFenceBreaks('plain preview text')).toBe('plain preview text');
  });
});
