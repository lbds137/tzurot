import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type StoredReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { writeTriggerReferences } from '@tzurot/conversation-history';
import { persistBuiltReferences } from './referencePersistence.js';

vi.mock('@tzurot/conversation-history', () => ({ writeTriggerReferences: vi.fn() }));

const reference: StoredReferencedMessage = {
  discordMessageId: 'ref-1',
  authorUsername: 'alice',
  authorDisplayName: 'Alice',
  content: 'quoted text',
  timestamp: '2026-07-31T12:00:00.000Z',
  locationContext: '',
  attachmentEnrichment: [{ url: 'https://cdn/a.png', kind: 'image', description: 'a cat' }],
};

describe('persistBuiltReferences', () => {
  const writeTriggerReferencesMock = vi.mocked(writeTriggerReferences);
  const prisma = {} as PrismaClient;

  beforeEach(() => {
    writeTriggerReferencesMock.mockReset().mockResolvedValue(1);
  });

  it('forwards the references and the trigger id to the history write', async () => {
    await persistBuiltReferences({
      prisma,
      references: [reference],
      personalityId: 'personality-1',
      scope: {
        channelId: 'chan-1',
        activePersonaId: 'persona-1',
        triggerMessageId: 'discord-42',
      },
    });

    expect(writeTriggerReferencesMock).toHaveBeenCalledWith(
      prisma,
      { channelId: 'chan-1', personalityId: 'personality-1', personaId: 'persona-1' },
      [reference],
      'discord-42'
    );
  });

  it('does nothing when the turn quoted nothing', async () => {
    await persistBuiltReferences({
      prisma,
      references: [],
      personalityId: 'personality-1',
      scope: { channelId: 'chan-1', activePersonaId: 'persona-1' },
    });

    expect(writeTriggerReferencesMock).not.toHaveBeenCalled();
  });

  it('skips an anonymous summon, which has no history row of its own', async () => {
    await persistBuiltReferences({
      prisma,
      references: [reference],
      personalityId: 'personality-1',
      scope: { channelId: 'chan-1', activePersonaId: undefined },
    });

    expect(writeTriggerReferencesMock).not.toHaveBeenCalled();
  });

  it('skips when there is no channel to scope the row by', async () => {
    await persistBuiltReferences({
      prisma,
      references: [reference],
      personalityId: 'personality-1',
      scope: { channelId: '', activePersonaId: 'persona-1' },
    });

    expect(writeTriggerReferencesMock).not.toHaveBeenCalled();
  });
});
