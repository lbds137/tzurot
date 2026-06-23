import { describe, it, expect } from 'vitest';
import { deriveAttachmentCacheKey } from './attachmentCacheKey.js';

describe('deriveAttachmentCacheKey', () => {
  const PREFIX = 'transcript:';

  describe('id-preferred path', () => {
    it('uses the attachment id when present', () => {
      expect(deriveAttachmentCacheKey(PREFIX, { id: '12345', url: 'https://x/y' })).toBe(
        'transcript:id:12345'
      );
    });

    it('ignores the url entirely when an id is supplied', () => {
      const withQuery = deriveAttachmentCacheKey(PREFIX, { id: '999', url: 'https://x/y?ex=AAA' });
      const withoutQuery = deriveAttachmentCacheKey(PREFIX, { id: '999', url: 'https://z/w' });
      expect(withQuery).toBe(withoutQuery);
      expect(withQuery).toBe('transcript:id:999');
    });

    it('falls back to the url path when id is an empty string', () => {
      const key = deriveAttachmentCacheKey(PREFIX, { id: '', url: 'https://cdn/file.ogg' });
      expect(key.startsWith('transcript:url:')).toBe(true);
    });
  });

  describe('url-hash fallback (the volatile-signature fix)', () => {
    const base = 'https://cdn.discordapp.com/attachments/111/222/voice.ogg';

    it('produces the same key for the same base url regardless of signature query', () => {
      // Discord re-signs ex/is/hs on every re-fetch — these must collapse to one key.
      const signedA = `${base}?ex=AAAA&is=BBBB&hs=CCCC`;
      const signedB = `${base}?ex=DDDD&is=EEEE&hs=FFFF`;
      const keyA = deriveAttachmentCacheKey(PREFIX, { url: signedA });
      const keyB = deriveAttachmentCacheKey(PREFIX, { url: signedB });
      expect(keyA).toBe(keyB);
    });

    it('treats a query-less url and its signed form as the same key', () => {
      const bare = deriveAttachmentCacheKey(PREFIX, { url: base });
      const signed = deriveAttachmentCacheKey(PREFIX, { url: `${base}?ex=AAAA&is=BBBB&hs=CCCC` });
      expect(bare).toBe(signed);
    });

    it('produces different keys for different base paths', () => {
      const a = deriveAttachmentCacheKey(PREFIX, { url: `${base}?ex=AAAA` });
      const b = deriveAttachmentCacheKey(PREFIX, {
        url: 'https://cdn.discordapp.com/attachments/111/333/other.ogg?ex=AAAA',
      });
      expect(a).not.toBe(b);
    });

    it('namespaces the hash under `url:` and the given prefix', () => {
      const key = deriveAttachmentCacheKey('vision:', { url: base });
      expect(key.startsWith('vision:url:')).toBe(true);
      // sha256 hex digest is 64 chars
      expect(key.slice('vision:url:'.length)).toHaveLength(64);
    });
  });
});
