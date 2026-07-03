import { describe, it, expect } from 'vitest';
import { collectRefImageDescriptions } from './referenceImageDescriptions.js';
import type { StoredReferencedMessage } from '@tzurot/common-types/types/schemas/message';

function makeRef(attachments?: StoredReferencedMessage['attachments']): StoredReferencedMessage {
  return {
    discordMessageId: 'msg-1',
    authorUsername: 'alice',
    authorDisplayName: 'Alice',
    content: 'look at this',
    timestamp: '2026-06-17T00:00:00.000Z',
    locationContext: '',
    attachments,
  };
}

describe('collectRefImageDescriptions', () => {
  it('matches image attachments by URL and uses the attachment name as filename', () => {
    const ref = makeRef([
      { url: 'https://cdn/a.png', contentType: 'image/png', name: 'cat.png' },
      { url: 'https://cdn/b.jpg', contentType: 'image/jpeg', name: 'dog.jpg' },
    ]);
    const map = new Map([
      ['https://cdn/a.png', 'a tabby cat'],
      ['https://cdn/b.jpg', 'a golden retriever'],
    ]);

    expect(collectRefImageDescriptions(ref, map)).toEqual([
      { filename: 'cat.png', description: 'a tabby cat' },
      { filename: 'dog.jpg', description: 'a golden retriever' },
    ]);
  });

  it('falls back to "image" when an attachment has no name (matches hydrator behavior)', () => {
    const ref = makeRef([{ url: 'https://cdn/a.png', contentType: 'image/png' }]);
    const map = new Map([['https://cdn/a.png', 'a tabby cat']]);

    expect(collectRefImageDescriptions(ref, map)).toEqual([
      { filename: 'image', description: 'a tabby cat' },
    ]);
  });

  it('skips image attachments with no description in the map', () => {
    const ref = makeRef([
      { url: 'https://cdn/a.png', contentType: 'image/png', name: 'cat.png' },
      { url: 'https://cdn/unmatched.png', contentType: 'image/png', name: 'ghost.png' },
    ]);
    const map = new Map([['https://cdn/a.png', 'a tabby cat']]);

    expect(collectRefImageDescriptions(ref, map)).toEqual([
      { filename: 'cat.png', description: 'a tabby cat' },
    ]);
  });

  it('ignores non-image attachments even when their URL is in the map', () => {
    const ref = makeRef([
      { url: 'https://cdn/voice.ogg', contentType: 'audio/ogg', name: 'voice.ogg' },
      { url: 'https://cdn/doc.pdf', contentType: 'application/pdf', name: 'doc.pdf' },
    ]);
    const map = new Map([
      ['https://cdn/voice.ogg', 'should not be used'],
      ['https://cdn/doc.pdf', 'should not be used'],
    ]);

    expect(collectRefImageDescriptions(ref, map)).toEqual([]);
  });

  it('skips empty-string descriptions', () => {
    const ref = makeRef([{ url: 'https://cdn/a.png', contentType: 'image/png', name: 'cat.png' }]);
    const map = new Map([['https://cdn/a.png', '']]);

    expect(collectRefImageDescriptions(ref, map)).toEqual([]);
  });

  it('returns empty when the reference has no attachments', () => {
    expect(collectRefImageDescriptions(makeRef(undefined), new Map([['x', 'y']]))).toEqual([]);
    expect(collectRefImageDescriptions(makeRef([]), new Map([['x', 'y']]))).toEqual([]);
  });
});
