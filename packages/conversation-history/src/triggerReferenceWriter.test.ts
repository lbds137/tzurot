/**
 * Unit tests for the reference write and the row targeting it shares with the
 * service's content enrichment.
 *
 * `findTriggerMessage` gets its own block because both writes a job makes to
 * its history row go through it, and picking a different row for each is the
 * failure it exists to prevent. `writeTriggerReferences` is covered here
 * rather than through the service because it is no longer a service method —
 * it needs `$executeRaw`, which the service's client type does not carry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { type StoredReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { findTriggerMessage, writeTriggerReferences } from './triggerReferenceWriter.js';
import {
  type ConversationHistoryClient,
  type RawCapableConversationHistoryClient,
} from './ConversationMessageMapper.js';

const SCOPE = {
  channelId: 'channel-1',
  personalityId: 'personality-1',
  personaId: 'persona-1',
};

describe('findTriggerMessage', () => {
  let findFirst: ReturnType<typeof vi.fn>;
  let prisma: ConversationHistoryClient;

  beforeEach(() => {
    findFirst = vi.fn();
    prisma = { conversationHistory: { findFirst } } as unknown as ConversationHistoryClient;
  });

  it('matches the exact Discord message id when the job carries one', () => {
    findFirst.mockResolvedValue({ id: 'row-exact', messageMetadata: null });

    return findTriggerMessage(prisma, SCOPE, 'discord-7').then(found => {
      expect(found).toEqual({ id: 'row-exact', targeting: 'exact' });
      expect(findFirst).toHaveBeenCalledTimes(1);
      expect(findFirst).toHaveBeenCalledWith({
        where: { ...SCOPE, role: MessageRole.User, discordMessageId: { has: 'discord-7' } },
      });
    });
  });

  it('falls back to the most recent user row when the exact match misses', async () => {
    // The bot's trigger-message persist is best-effort — the row can be absent
    // under that id entirely, and the write still has somewhere sensible to go.
    findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'row-recent', messageMetadata: { embedsXml: [] } });

    const found = await findTriggerMessage(prisma, SCOPE, 'discord-7');

    expect(found?.id).toBe('row-recent');
    expect(found?.targeting).toBe('recent');
    expect(findFirst).toHaveBeenLastCalledWith({
      where: { ...SCOPE, role: MessageRole.User },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('skips the exact query entirely without an id', async () => {
    findFirst.mockResolvedValue({ id: 'row-recent', messageMetadata: null });

    const found = await findTriggerMessage(prisma, SCOPE, undefined);

    expect(found?.targeting).toBe('recent');
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({
      where: { ...SCOPE, role: MessageRole.User },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('treats an empty id as no id at all', async () => {
    findFirst.mockResolvedValue({ id: 'row-recent', messageMetadata: null });

    await findTriggerMessage(prisma, SCOPE, '');

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0][0].where).not.toHaveProperty('discordMessageId');
  });

  it('returns null when the conversation has no user row yet', async () => {
    findFirst.mockResolvedValue(null);

    expect(await findTriggerMessage(prisma, SCOPE, 'discord-7')).toBeNull();
  });
});

describe('writeTriggerReferences', () => {
  let findFirst: ReturnType<typeof vi.fn>;
  let executeRaw: ReturnType<typeof vi.fn>;
  let prisma: RawCapableConversationHistoryClient;

  // Typed, not inferred: without this the fixture's `kind` widens to `string`
  // and the compiler stops noticing when the schema's shape moves.
  const storedRef = (overrides: Partial<StoredReferencedMessage> = {}): StoredReferencedMessage =>
    ({
      discordMessageId: 'ref-msg-1',
      authorUsername: 'alice',
      authorDisplayName: 'Alice',
      content: 'look',
      timestamp: '2026-06-17T00:00:00.000Z',
      locationContext: '',
      attachments: [{ url: 'https://cdn/a.png', contentType: 'image/png', name: 'cat.png' }],
      attachmentEnrichment: [
        { url: 'https://cdn/a.png', kind: 'image', description: 'a tabby cat' },
      ],
      ...overrides,
    }) satisfies StoredReferencedMessage;

  beforeEach(() => {
    findFirst = vi.fn().mockResolvedValue({ id: 'row-1' });
    executeRaw = vi.fn().mockResolvedValue(1);
    prisma = {
      conversationHistory: { findFirst },
      $executeRaw: executeRaw,
    } as unknown as RawCapableConversationHistoryClient;
  });

  it('merges the references server-side instead of reading the column first', async () => {
    const count = await writeTriggerReferences(prisma, SCOPE, [storedRef()]);

    expect(count).toBe(1);
    // The seam that matters: one statement, and the patch carries ONLY this
    // writer's key. Anything it did not send survives because `||` merges.
    const [strings, patch, id] = executeRaw.mock.calls[0] as [string[], string, string];
    expect(strings.join('')).toContain('message_metadata = COALESCE(message_metadata');
    expect(JSON.parse(patch)).toEqual({ referencedMessages: [storedRef()] });
    expect(id).toBe('row-1');
    // No read of the column: that read is what created the lost-update race.
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('bumps updated_at, which raw SQL does not get from Prisma', async () => {
    await writeTriggerReferences(prisma, SCOPE, [storedRef()]);

    // conversation_history is sync-tracked and reconciles last-write-wins on
    // this column; a stale one lets a dev/prod sync revert the write.
    expect((executeRaw.mock.calls[0][0] as string[]).join('')).toContain('updated_at = NOW()');
  });

  it('leaves content and token_count alone', async () => {
    await writeTriggerReferences(prisma, SCOPE, [storedRef()]);

    const sql = (executeRaw.mock.calls[0][0] as string[]).join('');
    expect(sql).not.toContain('content =');
    expect(sql).not.toContain('token_count =');
  });

  it('returns 0 without touching the DB when there are no references', async () => {
    expect(await writeTriggerReferences(prisma, SCOPE, [])).toBe(0);
    expect(findFirst).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('returns 0 when no user row exists to write to', async () => {
    findFirst.mockResolvedValue(null);

    expect(await writeTriggerReferences(prisma, SCOPE, [storedRef()])).toBe(0);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('returns 0 when the row vanished between the lookup and the merge', async () => {
    // `missing` from the merge, not from the lookup — a distinct event, and
    // the caller must not report references it did not store.
    executeRaw.mockResolvedValue(0);

    expect(await writeTriggerReferences(prisma, SCOPE, [storedRef()])).toBe(0);
  });

  it('never throws — a failed read returns 0', async () => {
    findFirst.mockRejectedValue(new Error('db down'));

    await expect(writeTriggerReferences(prisma, SCOPE, [storedRef()])).resolves.toBe(0);
  });

  it('never throws — a failed merge returns 0', async () => {
    executeRaw.mockRejectedValue(new Error('update failed'));

    await expect(writeTriggerReferences(prisma, SCOPE, [storedRef()])).resolves.toBe(0);
  });
});
