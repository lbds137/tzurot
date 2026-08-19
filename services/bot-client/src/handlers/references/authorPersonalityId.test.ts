import { describe, expect, it, vi } from 'vitest';
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import {
  applyAuthorPersonalityIds,
  resolveAuthorPersonalityIds,
  type AuthorPersonalityLookups,
} from './authorPersonalityId.js';

const UUID_A = '11111111-2222-4333-8444-555555555555';

function makeRef(overrides: Partial<ReferencedMessage> = {}): ReferencedMessage {
  return {
    referenceNumber: 1,
    discordMessageId: 'msg-1',
    discordUserId: 'discord-1',
    authorUsername: 'testuser',
    authorDisplayName: 'Test User',
    content: 'quoted text',
    embeds: '',
    timestamp: '2026-01-01T00:00:00.000Z',
    locationContext: '<location />',
    authorRole: 'assistant',
    ...overrides,
  };
}

function lookups(cache: Record<string, string | null> = {}): AuthorPersonalityLookups & {
  fromWebhookCache: ReturnType<typeof vi.fn>;
} {
  return { fromWebhookCache: vi.fn(async (id: string) => cache[id] ?? null) };
}

describe('resolveAuthorPersonalityIds', () => {
  it('resolves an assistant-authored reference from the webhook cache', async () => {
    const l = lookups({ 'msg-1': UUID_A });

    expect((await resolveAuthorPersonalityIds([makeRef()], l)).get('msg-1')).toBe(UUID_A);
  });

  it('resolves nothing when the cache has expired, rather than guessing', async () => {
    // No second tier by design: the only other lookup available answers "which
    // personality is this message ABOUT", which is a different question and
    // would stamp a human's quote with a character's id. See the interface doc.
    const l = lookups({});

    expect((await resolveAuthorPersonalityIds([makeRef()], l)).size).toBe(0);
    expect(l.fromWebhookCache).toHaveBeenCalledWith('msg-1');
  });

  it('rejects a non-UUID cache value rather than carrying a name into from_id', async () => {
    // The webhook cache has historically held personality NAMES for some
    // entries. A name here would resolve against nothing in the roster and
    // re-introduce the name-keyed identity this resolution exists to remove.
    const l = lookups({ 'msg-1': 'Lilith' });

    expect((await resolveAuthorPersonalityIds([makeRef()], l)).size).toBe(0);
  });

  it('skips references stamped user or bot — those classifications are authoritative', async () => {
    const l = lookups({ 'msg-1': UUID_A, 'msg-2': UUID_A });

    const resolved = await resolveAuthorPersonalityIds(
      [
        makeRef({ discordMessageId: 'msg-1', authorRole: 'user' }),
        makeRef({ discordMessageId: 'msg-2', authorRole: 'bot' }),
      ],
      l
    );

    expect(resolved.size).toBe(0);
    expect(l.fromWebhookCache).not.toHaveBeenCalled();
  });

  it('DOES look up an unstamped reference — the reconnect case the stamp cannot cover', async () => {
    // classifyReferenceAuthorRole omits the stamp when the message is
    // machine-authored but our own identity is not yet known. A mapping hit is
    // positive proof our bot sent it.
    const l = lookups({ 'msg-1': UUID_A });

    const resolved = await resolveAuthorPersonalityIds([makeRef({ authorRole: undefined })], l);

    expect(resolved.get('msg-1')).toBe(UUID_A);
  });

  it('skips a forwarded snapshot — its id is the FORWARDING message, not the quote', async () => {
    // Discord's message_snapshots omit the original's id, so SnapshotFormatter
    // substitutes the wrapper's and stamps no authorRole. A hit on that key
    // would name whoever posted the wrapper, not whoever wrote the quoted text.
    const l = lookups({ 'msg-1': UUID_A });

    const resolved = await resolveAuthorPersonalityIds(
      [makeRef({ authorRole: undefined, isForwarded: true })],
      l
    );

    expect(resolved.size).toBe(0);
    expect(l.fromWebhookCache).not.toHaveBeenCalled();
  });

  it('still skips a forwarded reference that DID get an assistant stamp', async () => {
    // The non-snapshot forward path (MessageFormatter, deduped branch) does
    // classify a role. The id is still the forwarding message's, so the
    // exclusion is on forwarded-ness, not on the missing stamp.
    const l = lookups({ 'msg-1': UUID_A });

    const resolved = await resolveAuthorPersonalityIds(
      [makeRef({ authorRole: 'assistant', isForwarded: true })],
      l
    );

    expect(resolved.size).toBe(0);
    expect(l.fromWebhookCache).not.toHaveBeenCalled();
  });

  it('dispatches ONE lookup for two quotes of the same message', async () => {
    const l = lookups({ 'msg-1': UUID_A });

    await resolveAuthorPersonalityIds(
      [makeRef({ referenceNumber: 1 }), makeRef({ referenceNumber: 2 })],
      l
    );

    expect(l.fromWebhookCache).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all when no reference is eligible', async () => {
    const l = lookups({ 'msg-1': UUID_A });

    expect((await resolveAuthorPersonalityIds([makeRef({ authorRole: 'user' })], l)).size).toBe(0);
    expect((await resolveAuthorPersonalityIds([], l)).size).toBe(0);
    expect(l.fromWebhookCache).not.toHaveBeenCalled();
  });
});

describe('applyAuthorPersonalityIds', () => {
  it('stamps only the references whose message resolved', () => {
    const refs = [
      makeRef({ discordMessageId: 'msg-1' }),
      makeRef({ discordMessageId: 'msg-2', referenceNumber: 2 }),
    ];

    applyAuthorPersonalityIds(refs, new Map([['msg-1', UUID_A]]));

    expect(refs[0]?.authorPersonalityId).toBe(UUID_A);
    expect(refs[1]?.authorPersonalityId).toBeUndefined();
  });

  it('leaves every reference untouched when nothing resolved', () => {
    const refs = [makeRef()];

    applyAuthorPersonalityIds(refs, new Map());

    expect(refs[0]?.authorPersonalityId).toBeUndefined();
  });
});

describe('failure handling', () => {
  it('costs the id, never the reference set, when a lookup throws', async () => {
    const l: AuthorPersonalityLookups = {
      fromWebhookCache: vi.fn().mockRejectedValue(new Error('redis down')),
    };

    await expect(resolveAuthorPersonalityIds([makeRef()], l)).resolves.toEqual(new Map());
  });

  it('still resolves the references whose own lookups succeeded', async () => {
    const l: AuthorPersonalityLookups = {
      fromWebhookCache: vi.fn(async (id: string) => {
        if (id === 'msg-1') {
          throw new Error('redis down');
        }
        return UUID_A;
      }),
    };

    const resolved = await resolveAuthorPersonalityIds(
      [makeRef({ discordMessageId: 'msg-1' }), makeRef({ discordMessageId: 'msg-2' })],
      l
    );

    expect(resolved.get('msg-1')).toBeUndefined();
    expect(resolved.get('msg-2')).toBe(UUID_A);
  });
});
