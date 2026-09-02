import { describe, it, expect } from 'vitest';
import { escapeRegExp } from './regex.js';

describe('escapeRegExp', () => {
  it('escapes every regex metacharacter so the result matches the literal', () => {
    const literal = '.*+?^${}()|[]\\';
    const escaped = escapeRegExp(literal);
    expect(new RegExp(`^${escaped}$`).test(literal)).toBe(true);
  });

  it('leaves plain alphanumeric text untouched', () => {
    expect(escapeRegExp('abc123')).toBe('abc123');
  });
});
