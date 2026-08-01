import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type StoredReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { type ConversationHistoryService } from '@tzurot/conversation-history';
import { persistBuiltReferences } from './referencePersistence.js';

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
  let storeTriggerReferences: ReturnType<typeof vi.fn>;
  let history: ConversationHistoryService;

  beforeEach(() => {
    storeTriggerReferences = vi.fn().mockResolvedValue(1);
    history = { storeTriggerReferences } as unknown as ConversationHistoryService;
  });

  it('forwards the references and the trigger id to the history write', async () => {
    await persistBuiltReferences({
      history,
      references: [reference],
      personalityId: 'personality-1',
      scope: {
        channelId: 'chan-1',
        activePersonaId: 'persona-1',
        triggerMessageId: 'discord-42',
      },
    });

    expect(storeTriggerReferences).toHaveBeenCalledWith(
      'chan-1',
      'personality-1',
      'persona-1',
      [reference],
      'discord-42'
    );
  });

  it('does nothing when the turn quoted nothing', async () => {
    await persistBuiltReferences({
      history,
      references: [],
      personalityId: 'personality-1',
      scope: { channelId: 'chan-1', activePersonaId: 'persona-1' },
    });

    expect(storeTriggerReferences).not.toHaveBeenCalled();
  });

  it('skips an anonymous summon, which has no history row of its own', async () => {
    await persistBuiltReferences({
      history,
      references: [reference],
      personalityId: 'personality-1',
      scope: { channelId: 'chan-1', activePersonaId: undefined },
    });

    expect(storeTriggerReferences).not.toHaveBeenCalled();
  });

  it('skips when there is no channel to scope the row by', async () => {
    await persistBuiltReferences({
      history,
      references: [reference],
      personalityId: 'personality-1',
      scope: { channelId: '', activePersonaId: 'persona-1' },
    });

    expect(storeTriggerReferences).not.toHaveBeenCalled();
  });
});
