import { describe, it, expect, vi, afterEach } from 'vitest';
import pino from 'pino';

const getConfigMock = vi.hoisted(() => vi.fn());
vi.mock('../config/config.js', () => ({ getConfig: getConfigMock }));

import { contentPreviewsEnabled, contentPreview, contentDigest } from './logContentPreview.js';

const setConfig = (NODE_ENV: string, LOG_CONTENT_PREVIEWS: boolean): void => {
  getConfigMock.mockReturnValue({ NODE_ENV, LOG_CONTENT_PREVIEWS });
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('contentPreviewsEnabled', () => {
  it('is true only for development with the flag on', () => {
    setConfig('development', true);
    expect(contentPreviewsEnabled()).toBe(true);
  });

  it('is off in development without the flag', () => {
    setConfig('development', false);
    expect(contentPreviewsEnabled()).toBe(false);
  });

  it('is off outside development even with the flag on (production)', () => {
    setConfig('production', true);
    expect(contentPreviewsEnabled()).toBe(false);
  });

  it('is off outside development even with the flag on (test)', () => {
    setConfig('test', true);
    expect(contentPreviewsEnabled()).toBe(false);
  });
});

describe('contentPreview', () => {
  describe('with previews ON', () => {
    it('returns the full string when shorter than maxChars', () => {
      setConfig('development', true);
      expect(contentPreview('short text', 100)).toBe('short text');
    });

    it('returns a truncated string with a trailing ellipsis when longer than maxChars', () => {
      setConfig('development', true);
      const text = 'a'.repeat(50);
      expect(contentPreview(text, 10)).toBe('a'.repeat(10) + '...');
    });

    it('returns exactly maxChars characters plus the ellipsis for the truncated case', () => {
      setConfig('development', true);
      const text = 'abcdefghijklmnopqrstuvwxyz';
      const result = contentPreview(text, 5);
      expect(result).toBe('abcde...');
      expect(result?.length).toBe(5 + 3);
    });

    it('counts the cap in code points, not UTF-16 units, for astral text', () => {
      setConfig('development', true);
      // 12 butterflies = 24 UTF-16 units, so a unit-based cut at 10 keeps
      // only 5 of them.
      const text = '🦋'.repeat(12);
      const result = contentPreview(text, 10);

      expect(result).toBe('🦋'.repeat(10) + '...');
      expect([...(result ?? '')].length).toBe(10 + 3);
    });

    it('never emits a lone surrogate when the cap falls mid-pair in UTF-16', () => {
      setConfig('development', true);
      // An odd cap is where a unit-based cut splits a pair: `.substring(0, 9)`
      // over butterflies keeps 4 whole ones plus a dangling high surrogate.
      const text = '🦋'.repeat(12);
      const result = contentPreview(text, 9);

      expect(result).toBe('🦋'.repeat(9) + '...');
      // No unpaired high surrogate (a high surrogate not followed by a low one).
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(result ?? '')).toBe(false);
      // No unpaired low surrogate (a low surrogate not preceded by a high one).
      expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(result ?? '')).toBe(false);
    });
  });

  describe('with previews OFF', () => {
    it('returns undefined for a normal string', () => {
      setConfig('production', false);
      expect(contentPreview('some content', 100)).toBeUndefined();
    });

    it('never returns null (pino-omission property)', () => {
      setConfig('production', false);
      expect(contentPreview('some content', 100)).not.toBeNull();
    });
  });

  it('returns undefined for undefined input regardless of flag state', () => {
    setConfig('development', true);
    expect(contentPreview(undefined, 100)).toBeUndefined();
    setConfig('development', false);
    expect(contentPreview(undefined, 100)).toBeUndefined();
  });

  it('returns undefined for null input regardless of flag state', () => {
    setConfig('development', true);
    expect(contentPreview(null, 100)).toBeUndefined();
    setConfig('development', false);
    expect(contentPreview(null, 100)).toBeUndefined();
  });

  it('an omitted undefined preview field is absent from the emitted pino line, while a length field survives', () => {
    setConfig('production', false);
    const chunks: string[] = [];
    const log = pino({ base: null, timestamp: false }, {
      write: (s: string) => chunks.push(s),
    } as never);

    log.info({ preview: contentPreview('abc', 10), length: 3 }, 'test log line');

    const parsed = JSON.parse(chunks[0]) as Record<string, unknown>;
    expect('preview' in parsed).toBe(false);
    expect(parsed.length).toBe(3);
  });
});

describe('contentDigest', () => {
  it('is 12 hex characters', () => {
    expect(contentDigest('hello world')).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is stable for the same input', () => {
    expect(contentDigest('same text')).toBe(contentDigest('same text'));
  });

  it('differs for different input', () => {
    expect(contentDigest('text A')).not.toBe(contentDigest('text B'));
  });

  it('is unaffected by the flag being off', () => {
    setConfig('production', false);
    const off = contentDigest('consistent input');
    setConfig('development', true);
    const on = contentDigest('consistent input');
    expect(off).toBe(on);
  });
});
