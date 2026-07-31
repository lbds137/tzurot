import { describe, expect, it } from 'vitest';

import { isInsideCodeSpan } from './codeSpanDetection.js';

/** Offset of `needle` in `text`, asserted to exist so a typo fails loudly. */
function offsetOf(text: string, needle: string): number {
  const index = text.indexOf(needle);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

describe('isInsideCodeSpan', () => {
  describe('plain text', () => {
    it('reports false for an offset in ordinary prose', () => {
      const text = 'The answer is <thinking> according to the docs.';
      expect(isInsideCodeSpan(text, offsetOf(text, '<thinking>'))).toBe(false);
    });

    it('reports false for offset zero regardless of content', () => {
      expect(isInsideCodeSpan('`backticked`', 0)).toBe(false);
    });

    it('reports false for a negative offset', () => {
      expect(isInsideCodeSpan('anything', -1)).toBe(false);
    });

    it('reports false for empty text', () => {
      expect(isInsideCodeSpan('', 5)).toBe(false);
    });
  });

  describe('inline code', () => {
    it('reports true inside an inline span', () => {
      const text = 'Models emit a `</think>` marker before answering.';
      expect(isInsideCodeSpan(text, offsetOf(text, '</think>'))).toBe(true);
    });

    it('reports false after the span closes', () => {
      const text = 'A `</think>` marker, then <thinking> in prose.';
      expect(isInsideCodeSpan(text, offsetOf(text, '<thinking>'))).toBe(false);
    });

    it('reports true for an unterminated span on the same line', () => {
      // The production trigger: the model opened an inline span and the tag
      // followed immediately, with the closing backtick lines later.
      const text = 'the fragment `<thinking>\nI am a\n???`. Not a prompt.';
      expect(isInsideCodeSpan(text, offsetOf(text, '<thinking>'))).toBe(true);
    });

    it('does not let an unmatched backtick leak past a newline', () => {
      const text = 'A stray ` backtick here.\nThen <thinking> on the next line.';
      expect(isInsideCodeSpan(text, offsetOf(text, '<thinking>'))).toBe(false);
    });

    it('handles several spans on one line', () => {
      const text = 'Use `a` then `b` and finally <thinking> plainly.';
      expect(isInsideCodeSpan(text, offsetOf(text, '<thinking>'))).toBe(false);
      expect(isInsideCodeSpan(text, offsetOf(text, 'b'))).toBe(true);
    });
  });

  describe('fenced blocks', () => {
    it('reports true inside a fence', () => {
      const text = 'Example:\n```\n<thinking>\n```\nDone.';
      expect(isInsideCodeSpan(text, offsetOf(text, '<thinking>'))).toBe(true);
    });

    it('reports false after the fence closes', () => {
      const text = '```\ncode\n```\nNow <thinking> in prose.';
      expect(isInsideCodeSpan(text, offsetOf(text, '<thinking>'))).toBe(false);
    });

    it('reports true inside a language-tagged fence', () => {
      const text = '```xml\n<thinking>reasoning</thinking>\n```';
      expect(isInsideCodeSpan(text, offsetOf(text, '<thinking>'))).toBe(true);
    });

    it('treats single backticks inside a fence as literal content', () => {
      const text = '```\na ` lone backtick\n```\nThen <thinking> in prose.';
      expect(isInsideCodeSpan(text, offsetOf(text, '<thinking>'))).toBe(false);
    });

    it('reports true for an unterminated fence', () => {
      const text = 'Look:\n```\n<thinking> and the fence never closes';
      expect(isInsideCodeSpan(text, offsetOf(text, '<thinking>'))).toBe(true);
    });

    it('clears a pending inline span when a fence opens', () => {
      // Without the reset, the unmatched backtick before the fence would keep
      // reporting `true` for every later offset outside the fence.
      const text = 'A stray ` then\n```\nfenced\n```\nplain <thinking> here.';
      expect(isInsideCodeSpan(text, offsetOf(text, '<thinking>'))).toBe(false);
    });
  });
});
