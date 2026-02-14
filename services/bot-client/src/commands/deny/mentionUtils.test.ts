import { describe, it, expect } from 'vitest';
import { stripMention } from './mentionUtils.js';

describe('stripMention', () => {
  it('should strip standard mention wrapper', () => {
    expect(stripMention('<@999888777>')).toBe('999888777');
  });

  it('should strip nickname mention wrapper', () => {
    expect(stripMention('<@!999888777>')).toBe('999888777');
  });

  it('should return raw IDs unchanged', () => {
    expect(stripMention('999888777')).toBe('999888777');
  });

  it('should return non-mention strings unchanged', () => {
    expect(stripMention('hello')).toBe('hello');
  });

  it('should not strip partial mention patterns', () => {
    expect(stripMention('<@123> extra')).toBe('<@123> extra');
    expect(stripMention('prefix <@123>')).toBe('prefix <@123>');
  });
});
