/**
 * Stored Reference Hydrator Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hydrateStoredReferences } from './storedReferenceHydrator.js';
import type { StoredReferencedMessage } from '@tzurot/common-types';
import type { RawHistoryEntry } from '../jobs/utils/conversationTypes.js';

// Mock dependencies
vi.mock('@tzurot/common-types', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockBatchResolveByDiscordIds = vi.fn();
vi.mock('./reference/BatchResolvers.js', () => ({
  batchResolveByDiscordIds: (...args: unknown[]) => mockBatchResolveByDiscordIds(...args),
}));

function createMockVisionCache() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    setL2Cache: vi.fn(),
  };
}

function createMockPrisma() {
  return {} as never;
}

function makeRef(overrides: Partial<StoredReferencedMessage> = {}): StoredReferencedMessage {
  return {
    discordMessageId: '123',
    authorUsername: 'testuser',
    authorDisplayName: 'Test User',
    content: 'Some content',
    timestamp: '2026-01-01T00:00:00.000Z',
    locationContext: '',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<RawHistoryEntry> = {}): RawHistoryEntry {
  return {
    role: 'user',
    content: 'Hello',
    messageMetadata: {
      referencedMessages: [makeRef()],
    },
    ...overrides,
  } as RawHistoryEntry;
}

describe('hydrateStoredReferences', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockBatchResolveByDiscordIds.mockResolvedValue(new Map());
  });

  it('returns early for undefined history', async () => {
    const prisma = createMockPrisma();
    const cache = createMockVisionCache();

    await hydrateStoredReferences(undefined, prisma, cache as never);

    expect(mockBatchResolveByDiscordIds).not.toHaveBeenCalled();
  });

  it('returns early for empty history', async () => {
    const prisma = createMockPrisma();
    const cache = createMockVisionCache();

    await hydrateStoredReferences([], prisma, cache as never);

    expect(mockBatchResolveByDiscordIds).not.toHaveBeenCalled();
  });

  it('returns early when no referencedMessages in history', async () => {
    const prisma = createMockPrisma();
    const cache = createMockVisionCache();
    const history: RawHistoryEntry[] = [{ role: 'user', content: 'Hello' }];

    await hydrateStoredReferences(history, prisma, cache as never);

    expect(mockBatchResolveByDiscordIds).not.toHaveBeenCalled();
  });

  it('resolves personas by Discord ID and mutates refs', async () => {
    const prisma = createMockPrisma();
    const cache = createMockVisionCache();

    const ref = makeRef({ authorDiscordId: 'discord-456' });
    const history = [makeEntry({ messageMetadata: { referencedMessages: [ref] } })];

    mockBatchResolveByDiscordIds.mockResolvedValue(
      new Map([
        [
          'discord-456',
          {
            personaId: 'persona-uuid-789',
            personaName: 'Lila',
            preferredName: 'Lila',
            pronouns: 'she/her',
            content: '',
          },
        ],
      ])
    );

    await hydrateStoredReferences(history as RawHistoryEntry[], prisma, cache as never);

    expect(ref.resolvedPersonaName).toBe('Lila');
    expect(ref.resolvedPersonaId).toBe('persona-uuid-789');
  });

  it('skips persona resolution when no authorDiscordId present', async () => {
    const prisma = createMockPrisma();
    const cache = createMockVisionCache();

    const ref = makeRef(); // No authorDiscordId
    const history = [makeEntry({ messageMetadata: { referencedMessages: [ref] } })];

    await hydrateStoredReferences(history as RawHistoryEntry[], prisma, cache as never);

    // Should not have called batch resolve (no discord IDs to resolve)
    expect(mockBatchResolveByDiscordIds).not.toHaveBeenCalled();
    expect(ref.resolvedPersonaName).toBeUndefined();
  });

  it('leaves ref unchanged when persona not found', async () => {
    const prisma = createMockPrisma();
    const cache = createMockVisionCache();

    const ref = makeRef({ authorDiscordId: 'unknown-discord-id' });
    const history = [makeEntry({ messageMetadata: { referencedMessages: [ref] } })];

    mockBatchResolveByDiscordIds.mockResolvedValue(new Map());

    await hydrateStoredReferences(history as RawHistoryEntry[], prisma, cache as never);

    expect(ref.resolvedPersonaName).toBeUndefined();
    expect(ref.resolvedPersonaId).toBeUndefined();
  });

  it('resolves vision descriptions from cache for image attachments', async () => {
    const prisma = createMockPrisma();
    const cache = createMockVisionCache();

    const ref = makeRef({
      attachments: [
        {
          id: 'att-1',
          url: 'https://cdn.discord.com/img.png',
          contentType: 'image/png',
          name: 'photo.png',
        },
      ],
    });
    const history = [makeEntry({ messageMetadata: { referencedMessages: [ref] } })];

    cache.get.mockResolvedValue('A beautiful sunset over the ocean');

    await hydrateStoredReferences(history as RawHistoryEntry[], prisma, cache as never);

    expect(cache.get).toHaveBeenCalledWith({
      attachmentId: 'att-1',
      url: 'https://cdn.discord.com/img.png',
    });
    expect(ref.resolvedImageDescriptions).toEqual([
      { filename: 'photo.png', description: 'A beautiful sunset over the ocean' },
    ]);
  });

  it('skips non-image attachments for vision lookup', async () => {
    const prisma = createMockPrisma();
    const cache = createMockVisionCache();

    const ref = makeRef({
      attachments: [
        {
          id: 'att-1',
          url: 'https://cdn.discord.com/doc.pdf',
          contentType: 'application/pdf',
          name: 'doc.pdf',
        },
      ],
    });
    const history = [makeEntry({ messageMetadata: { referencedMessages: [ref] } })];

    await hydrateStoredReferences(history as RawHistoryEntry[], prisma, cache as never);

    expect(cache.get).not.toHaveBeenCalled();
    expect(ref.resolvedImageDescriptions).toBeUndefined();
  });

  it('handles vision cache miss gracefully', async () => {
    const prisma = createMockPrisma();
    const cache = createMockVisionCache();

    const ref = makeRef({
      attachments: [
        {
          id: 'att-1',
          url: 'https://cdn.discord.com/img.png',
          contentType: 'image/png',
          name: 'photo.png',
        },
      ],
    });
    const history = [makeEntry({ messageMetadata: { referencedMessages: [ref] } })];

    cache.get.mockResolvedValue(null); // Cache miss

    await hydrateStoredReferences(history as RawHistoryEntry[], prisma, cache as never);

    expect(ref.resolvedImageDescriptions).toBeUndefined();
  });

  it('deduplicates Discord IDs across multiple refs', async () => {
    const prisma = createMockPrisma();
    const cache = createMockVisionCache();

    const ref1 = makeRef({ authorDiscordId: 'discord-456' });
    const ref2 = makeRef({ authorDiscordId: 'discord-456', discordMessageId: '999' });
    const history = [makeEntry({ messageMetadata: { referencedMessages: [ref1, ref2] } })];

    mockBatchResolveByDiscordIds.mockResolvedValue(
      new Map([
        [
          'discord-456',
          {
            personaId: 'p1',
            personaName: 'Lila',
            preferredName: null,
            pronouns: null,
            content: '',
          },
        ],
      ])
    );

    await hydrateStoredReferences(history as RawHistoryEntry[], prisma, cache as never);

    // Should only call batch resolve once with deduplicated IDs
    expect(mockBatchResolveByDiscordIds).toHaveBeenCalledWith(prisma, ['discord-456']);
    // Both refs should be hydrated
    expect(ref1.resolvedPersonaName).toBe('Lila');
    expect(ref2.resolvedPersonaName).toBe('Lila');
  });

  it('uses "image" as default filename when name is missing', async () => {
    const prisma = createMockPrisma();
    const cache = createMockVisionCache();

    const ref = makeRef({
      attachments: [
        { id: 'att-1', url: 'https://cdn.discord.com/img.png', contentType: 'image/jpeg' },
      ],
    });
    const history = [makeEntry({ messageMetadata: { referencedMessages: [ref] } })];

    cache.get.mockResolvedValue('A cat sitting on a mat');

    await hydrateStoredReferences(history as RawHistoryEntry[], prisma, cache as never);

    expect(ref.resolvedImageDescriptions).toEqual([
      { filename: 'image', description: 'A cat sitting on a mat' },
    ]);
  });

  it('handles both persona and vision hydration together', async () => {
    const prisma = createMockPrisma();
    const cache = createMockVisionCache();

    const ref = makeRef({
      authorDiscordId: 'discord-456',
      attachments: [
        {
          id: 'att-1',
          url: 'https://cdn.discord.com/img.png',
          contentType: 'image/png',
          name: 'photo.png',
        },
      ],
    });
    const history = [makeEntry({ messageMetadata: { referencedMessages: [ref] } })];

    mockBatchResolveByDiscordIds.mockResolvedValue(
      new Map([
        [
          'discord-456',
          {
            personaId: 'p1',
            personaName: 'Lila',
            preferredName: null,
            pronouns: null,
            content: '',
          },
        ],
      ])
    );
    cache.get.mockResolvedValue('A sunset photo');

    await hydrateStoredReferences(history as RawHistoryEntry[], prisma, cache as never);

    expect(ref.resolvedPersonaName).toBe('Lila');
    expect(ref.resolvedPersonaId).toBe('p1');
    expect(ref.resolvedImageDescriptions).toEqual([
      { filename: 'photo.png', description: 'A sunset photo' },
    ]);
  });
});
