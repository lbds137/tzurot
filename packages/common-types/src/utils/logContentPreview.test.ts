import { describe, it, expect, vi, afterEach } from 'vitest';
import pino from 'pino';

const getConfigMock = vi.hoisted(() => vi.fn());
vi.mock('../config/config.js', () => ({ getConfig: getConfigMock }));

import {
  contentPreviewsEnabled,
  contentPreview,
  contentDigest,
  idPrefix,
  filenameShape,
  attachmentUrlShape,
} from './logContentPreview.js';

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

describe('idPrefix', () => {
  it('defaults to the first 8 characters on a UUID-shaped string', () => {
    setConfig('production', false);
    expect(idPrefix('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('a1b2c3d4');
  });

  it('returns the first n characters for an explicit width', () => {
    setConfig('production', false);
    expect(idPrefix('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 12)).toBe('a1b2c3d4-e5f');
  });

  it('returns the whole value when it is shorter than n', () => {
    setConfig('production', false);
    expect(idPrefix('short', 20)).toBe('short');
  });

  it('returns the prefix even when content previews are disabled', () => {
    setConfig('production', false);
    expect(contentPreviewsEnabled()).toBe(false);
    expect(idPrefix('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('a1b2c3d4');
  });
});

describe('attachmentUrlShape', () => {
  it('keeps a Discord attachment as host + channel/attachment ids, dropping filename, query and fragment', () => {
    expect(
      attachmentUrlShape(
        'https://cdn.discordapp.com/attachments/123/456/photo.png?ex=1&hm=abc#frag'
      )
    ).toBe('cdn.discordapp.com/attachments/123/456');
  });

  it('never returns any part of a filename with dots and spaces', () => {
    const shape = attachmentUrlShape(
      'https://cdn.discordapp.com/attachments/123/456/my%20secret.diary.v2.txt?ex=1'
    );
    expect(shape).toBe('cdn.discordapp.com/attachments/123/456');
    expect(shape).not.toContain('secret');
    expect(shape).not.toContain('diary');
  });

  it('drops a filename that sits behind a trailing slash', () => {
    const shape = attachmentUrlShape(
      'https://cdn.discordapp.com/attachments/123/456/SENTINEL_TRAIL.png/'
    );
    expect(shape).toBe('cdn.discordapp.com/attachments/123/456');
    expect(shape).not.toContain('SENTINEL_TRAIL');
  });

  it('drops extra segments after the filename', () => {
    const shape = attachmentUrlShape(
      'https://cdn.discordapp.com/attachments/123/456/SENTINEL_NAME.png/SENTINEL_EXTRA/more'
    );
    expect(shape).toBe('cdn.discordapp.com/attachments/123/456');
    expect(shape).not.toContain('SENTINEL');
  });

  it('never returns a percent-encoded filename', () => {
    const shape = attachmentUrlShape(
      'https://cdn.discordapp.com/attachments/123/456/SENTINEL%20ENC%2Fname.png'
    );
    expect(shape).toBe('cdn.discordapp.com/attachments/123/456');
    expect(shape).not.toContain('SENTINEL');
    expect(shape).not.toContain('%');
  });

  it('drops a signed query and a fragment', () => {
    const shape = attachmentUrlShape(
      'https://cdn.discordapp.com/attachments/123/456/SENTINEL_FILE.png?ex=SENTINEL_EX&hm=SENTINEL_HM#SENTINEL_FRAG'
    );
    expect(shape).toBe('cdn.discordapp.com/attachments/123/456');
    expect(shape).not.toContain('SENTINEL');
  });

  it('keeps the attachment ids for media.discordapp.net', () => {
    const shape = attachmentUrlShape(
      'https://media.discordapp.net/attachments/123/456/SENTINEL_MEDIA.png?width=10'
    );
    expect(shape).toBe('media.discordapp.net/attachments/123/456');
    expect(shape).not.toContain('SENTINEL');
  });

  it('returns only the host for a non-Discord host with a deep path', () => {
    const shape = attachmentUrlShape(
      'https://files.example.test/SENTINEL_DIR/SENTINEL_SUB/SENTINEL_NAME.png?token=SENTINEL_TOKEN'
    );
    expect(shape).toBe('files.example.test');
    expect(shape).not.toContain('SENTINEL');
  });

  it('returns only the host for a Discord CDN URL off the attachments route', () => {
    const shape = attachmentUrlShape(
      'https://cdn.discordapp.com/avatars/123/SENTINEL_AVATAR.png?size=64'
    );
    expect(shape).toBe('cdn.discordapp.com');
    expect(shape).not.toContain('SENTINEL');
  });

  it('returns only the host when the attachments route has non-numeric ids', () => {
    const shape = attachmentUrlShape(
      'https://cdn.discordapp.com/attachments/SENTINEL_CHAN/456/name.png'
    );
    expect(shape).toBe('cdn.discordapp.com');
    expect(shape).not.toContain('SENTINEL');
  });

  it('keeps the route name and ids for an ephemeral-attachments URL, dropping filename and query', () => {
    const shape = attachmentUrlShape(
      'https://cdn.discordapp.com/ephemeral-attachments/123/456/SENTINEL_EPH.png?ex=SENTINEL_EX&hm=SENTINEL_HM'
    );
    expect(shape).toBe('cdn.discordapp.com/ephemeral-attachments/123/456');
    expect(shape).not.toContain('SENTINEL');
  });

  it('returns only the host when the ephemeral-attachments route has non-numeric ids', () => {
    const shape = attachmentUrlShape(
      'https://cdn.discordapp.com/ephemeral-attachments/SENTINEL_CHAN/456/name.png'
    );
    expect(shape).toBe('cdn.discordapp.com');
    expect(shape).not.toContain('SENTINEL');
  });

  it('returns a fixed token for an IPv4 literal host, never the address', () => {
    const shape = attachmentUrlShape('http://203.0.113.5/SENTINEL_IP.png');
    expect(shape).toBe('[ip-host]');
    expect(shape).not.toContain('203');
  });

  it('returns a fixed token for an IPv4 literal host with a port', () => {
    const shape = attachmentUrlShape('http://203.0.113.5:8080/SENTINEL_IP.png');
    expect(shape).toBe('[ip-host]');
    expect(shape).not.toContain('203');
    expect(shape).not.toContain('8080');
  });

  it('returns a fixed token for a bracketed IPv6 literal host, never the address', () => {
    const shape = attachmentUrlShape('http://[2001:db8::1]/SENTINEL_IP.png');
    expect(shape).toBe('[ip-host]');
    expect(shape).not.toContain('2001');
  });

  it('returns the host alone for a path with one segment', () => {
    expect(attachmentUrlShape('https://example.com/only.png')).toBe('example.com');
  });

  it('returns the host alone for a bare-host URL', () => {
    expect(attachmentUrlShape('https://example.com/')).toBe('example.com');
  });

  it('returns a fixed token for a data: URL, never the payload', () => {
    expect(attachmentUrlShape('data:image/png;base64,AAAA')).toBe('[unparsable-url]');
  });

  it('returns a fixed token for an unparsable string, never the raw input', () => {
    const shape = attachmentUrlShape('not a url secret.png');
    expect(shape).toBe('[unparsable-url]');
    expect(shape).not.toContain('secret');
  });

  it('returns undefined for undefined and null, like filenameShape', () => {
    expect(attachmentUrlShape(undefined)).toBeUndefined();
    expect(attachmentUrlShape(null)).toBeUndefined();
  });
});

describe('filenameShape', () => {
  it('extracts a lowercased extension and the full name length', () => {
    expect(filenameShape('photo.PNG')).toEqual({ extension: 'png', nameLength: 9 });
  });

  it('returns extension undefined when there is no dot', () => {
    expect(filenameShape('README')).toEqual({ extension: undefined, nameLength: 6 });
  });

  it('treats a dotfile as having no extension', () => {
    expect(filenameShape('.env')).toEqual({ extension: undefined, nameLength: 4 });
  });

  it('uses the text after the LAST dot for a multi-dot name', () => {
    expect(filenameShape('archive.tar.gz')).toEqual({ extension: 'gz', nameLength: 14 });
  });

  it('rejects a candidate extension longer than 10 characters', () => {
    const name = 'a.abcdefghijk'; // 11-char candidate
    expect(filenameShape(name)).toEqual({ extension: undefined, nameLength: name.length });
  });

  it('rejects a non-alphanumeric candidate extension', () => {
    expect(filenameShape('x.my secret')).toEqual({ extension: undefined, nameLength: 11 });
  });

  it('rejects a trailing dot with no extension', () => {
    expect(filenameShape('file.')).toEqual({ extension: undefined, nameLength: 5 });
  });

  it('returns undefined for null input', () => {
    expect(filenameShape(null)).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(filenameShape(undefined)).toBeUndefined();
  });

  it('never leaks the filename stem into the serialized result', () => {
    const serialized = JSON.stringify(filenameShape('secret-diary.txt'));
    expect(serialized).not.toContain('secret');
  });

  it('counts an astral emoji as one code point, not two UTF-16 units', () => {
    expect(filenameShape('😀.png')).toEqual({ extension: 'png', nameLength: 5 });
  });
});
