import { describe, expect, it } from 'vitest';

import { isInsideCodeSpan, replaceOutsideCodeMarkup } from './codeSpanDetection.js';

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

  describe('backtick runs', () => {
    // A run of N backticks opens a span that only a matching run closes, which
    // is what makes the double-backtick form work. Treating each backtick as an
    // independent toggle nets a two-backtick span out to "not code" — and that
    // failure direction makes callers EXTRACT, i.e. delete the quoted example.
    it('reports true inside a double-backtick span', () => {
      const text = 'Models emit a ``<think>`` marker before answering.';
      expect(isInsideCodeSpan(text, offsetOf(text, '<think>'))).toBe(true);
    });

    it('treats a lone backtick inside a double-backtick span as content', () => {
      // The reason double-backtick spans exist: code containing a literal
      // backtick. The shorter run must not terminate the longer one.
      //
      // This row passed before runs were modelled, but only by parity accident
      // (an odd number of backticks preceded the offset). It pins the RULE now,
      // not the coincidence.
      const text = 'Write ``a ` b <think>`` please.';
      expect(isInsideCodeSpan(text, offsetOf(text, '<think>'))).toBe(true);
    });

    it('closes a double-backtick span only on a matching run', () => {
      const text = 'Use ``x ` y`` then <think> plainly.';
      expect(isInsideCodeSpan(text, offsetOf(text, '<think>'))).toBe(false);
    });

    it('reports true inside a four-backtick fence', () => {
      // Also passed pre-change, since `startsWith('```')` matched the first
      // three of four. Kept to pin that longer fences stay fences.
      const text = 'Look:\n````\n<think>\n````\ndone';
      expect(isInsideCodeSpan(text, offsetOf(text, '<think>'))).toBe(true);
    });

    it('does not close a four-backtick fence on a three-backtick run', () => {
      const text = 'Look:\n````\ncode\n```\nstill fenced <think>';
      expect(isInsideCodeSpan(text, offsetOf(text, '<think>'))).toBe(true);
    });

    it('does not let a double-backtick span leak past a newline', () => {
      // Inline spans die at a newline whatever their run length — otherwise one
      // unmatched pair marks the rest of the document as code.
      const text = 'A stray ``here.\nThen <think> on the next line.';
      expect(isInsideCodeSpan(text, offsetOf(text, '<think>'))).toBe(false);
    });
  });
});

describe('replaceOutsideCodeMarkup', () => {
  // The offset is found by TYPE, not by position, so these pin the property
  // directly rather than only through the patterns that happen to exist in any
  // one caller today. The named-group row is the one that matters: it is where a
  // positional `args.length - 2` silently reads the input string instead of the
  // offset, with no type error, and the strip would then be made against the
  // wrong position rather than fail loudly.
  const shapes: [label: string, pattern: RegExp][] = [
    ['no capture groups', /<\/chat_log>/g],
    ['one positional group', /<\/(chat_log)>/g],
    ['two positional groups', /<(\/)(chat_log)>/g],
    ['a NAMED group', /<\/(?<tag>chat_log)>/g],
    ['named and positional groups', /<(\/)(?<tag>chat_log)>/g],
  ];

  describe.each(shapes)('%s', (_label, pattern) => {
    it('spares a quoted match and strips an unquoted one', () => {
      const text = 'quoted `</chat_log>` then real </chat_log>';
      expect(replaceOutsideCodeMarkup(text, pattern)).toBe('quoted `</chat_log>` then real ');
    });
  });

  describe('offsetWithinMatch', () => {
    // The chimera-artifact shape, verbatim in structure: it deliberately matches
    // from the preceding newline through the delimiter, so the MATCH START sits
    // outside the backtick span the quoted delimiter lives in. Gating on the
    // match start therefore never fires, and the strip eats the quoted example
    // while leaving its closing backtick dangling — the observed production bug.
    const pattern = /(?:^|[\r\n])[\s]{0,50}[^\s<.]{0,9}\.[\s]{0,50}<\/(think)>/gi;
    const atDelimiter = (match: string): number => match.lastIndexOf('</');

    it('gating on the match start eats the quoted example, leaving a dangling backtick', () => {
      const text = 'Look:\n`token. </think>` is the shape.';
      expect(replaceOutsideCodeMarkup(text, pattern)).toBe('Look:` is the shape.');
    });

    it('spares the quoted match when probed at the delimiter', () => {
      const text = 'Look:\n`token. </think>` is the shape.';
      expect(replaceOutsideCodeMarkup(text, pattern, atDelimiter)).toBe(text);
    });

    it('still strips an unquoted match when probed at the delimiter', () => {
      const text = 'Look:\ntoken. </think> is the shape.';
      expect(replaceOutsideCodeMarkup(text, pattern, atDelimiter)).toBe('Look: is the shape.');
    });
  });
});
