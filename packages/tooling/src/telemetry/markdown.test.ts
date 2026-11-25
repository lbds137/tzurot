import { describe, it, expect } from 'vitest';
import { escapeTableCell } from './markdown.js';

describe('escapeTableCell', () => {
  it('escapes a pipe so it cannot add a cell', () => {
    expect(escapeTableCell('Evil|Host')).toBe('Evil\\|Host');
  });

  it('escapes every pipe, not only the first', () => {
    expect(escapeTableCell('a|b|c')).toBe('a\\|b\\|c');
  });

  it('flattens an LF newline to a space so it cannot start a new row', () => {
    expect(escapeTableCell('bad\nmodel')).toBe('bad model');
  });

  it('flattens a CRLF newline to a single space', () => {
    expect(escapeTableCell('bad\r\nmodel')).toBe('bad model');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeTableCell('anthropic/claude-haiku-5.5')).toBe('anthropic/claude-haiku-5.5');
  });
});
