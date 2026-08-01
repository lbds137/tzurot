/**
 * Unit tests for trigger-row targeting.
 *
 * `ConversationHistoryService.test.ts` covers the write through the service's
 * public method; this covers `findTriggerMessage` on its own, because both
 * writes a job makes to its history row go through it and picking a different
 * row for each is the failure it exists to prevent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { findTriggerMessage } from './triggerReferenceWriter.js';
import { type ConversationHistoryClient } from './ConversationMessageMapper.js';

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
      expect(found).toEqual({ id: 'row-exact', messageMetadata: null, targeting: 'exact' });
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
