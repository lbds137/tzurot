import { describe, it, expect, vi } from 'vitest';
import {
  collectRefImageDescriptions,
  writeReferenceImageDescriptions,
} from './referenceImageDescriptions.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
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

describe('writeReferenceImageDescriptions — write-path guards', () => {
  const scope = { channelId: 'chan-1', personalityId: 'pers-1', personaId: 'persona-1' };

  function makePrisma(findFirstResult: unknown): {
    prisma: PrismaClient;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  } {
    const findFirst = vi.fn().mockResolvedValue(findFirstResult);
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      conversationHistory: { findFirst, update },
    } as unknown as PrismaClient;
    return { prisma, findFirst, update };
  }

  it('short-circuits on an empty description map without querying at all', async () => {
    const { prisma, findFirst } = makePrisma(null);

    const written = await writeReferenceImageDescriptions(prisma, scope, new Map());

    expect(written).toBe(0);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('returns 0 when no user message exists in scope', async () => {
    const { prisma, update } = makePrisma(null);

    const written = await writeReferenceImageDescriptions(
      prisma,
      scope,
      new Map([['https://cdn/a.png', 'a cat']])
    );

    expect(written).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 0 when the last message has no referenced-message metadata', async () => {
    const { prisma, update } = makePrisma({ id: 'row-1', messageMetadata: null });

    const written = await writeReferenceImageDescriptions(
      prisma,
      scope,
      new Map([['https://cdn/a.png', 'a cat']])
    );

    expect(written).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('scopes the last-user-message lookup to the given channel/personality/persona + user role', async () => {
    const { prisma, findFirst } = makePrisma(null);

    await writeReferenceImageDescriptions(prisma, scope, new Map([['u', 'd']]));

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ...scope, role: 'user' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    );
  });
});
