/**
 * Tests for the preserve-input-on-validation-failure affordance.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction, ModalBuilder } from 'discord.js';
import {
  buildModalRetryRow,
  isModalRetryInteraction,
  replyWithModalRetry,
  stashModalRetry,
  handleModalRetry,
} from './retry.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const sessionManagerMock = {
  set: vi.fn(),
  findByMessageId: vi.fn(),
};
vi.mock('../dashboard/index.js', () => ({
  getSessionManager: () => sessionManagerMock,
}));

const showModalMock = vi.hoisted(() => vi.fn());
vi.mock('../dashboard/showModalWithTimeoutCatch.js', () => ({
  showModalWithTimeoutCatch: showModalMock,
}));

function makeInteraction(): ButtonInteraction {
  return {
    customId: 'character::modal-retry',
    user: { id: 'user-1' },
    message: { id: 'reply-1' },
    reply: vi.fn(),
  } as unknown as ButtonInteraction;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildModalRetryRow / isModalRetryInteraction', () => {
  it('builds a Try-again button whose customId the guard recognizes', () => {
    const row = buildModalRetryRow('character').toJSON() as {
      components: { custom_id: string; label?: string }[];
    };
    expect(row.components[0].custom_id).toBe('character::modal-retry');
    expect(row.components[0].label).toBe('Try again');

    expect(isModalRetryInteraction('character::modal-retry', 'character')).toBe(true);
    expect(isModalRetryInteraction('character::modal-retry', 'preset')).toBe(false);
    expect(isModalRetryInteraction('character::browse::0::all::', 'character')).toBe(false);
  });
});

describe('stashModalRetry', () => {
  it('stores the values in a message-id-keyed session', async () => {
    await stashModalRetry({
      userId: 'user-1',
      channelId: 'chan-1',
      messageId: 'reply-1',
      kind: 'seed',
      values: { name: 'Lilith', slug: 'bad slug!' },
    });

    expect(sessionManagerMock.set).toHaveBeenCalledWith({
      userId: 'user-1',
      entityType: 'modal-retry',
      entityId: 'reply-1',
      data: { kind: 'seed', values: { name: 'Lilith', slug: 'bad slug!' } },
      messageId: 'reply-1',
      channelId: 'chan-1',
    });
  });
});

describe('replyWithModalRetry', () => {
  it('sends the button-carrying reply and stashes the values in one call', async () => {
    const editReply = vi.fn().mockResolvedValue({ id: 'reply-9' });
    const interaction = {
      editReply,
      user: { id: 'user-1' },
      channelId: null,
    };

    await replyWithModalRetry(interaction as never, {
      commandPrefix: 'character',
      kind: 'seed',
      content: '❌ nope',
      values: { name: 'Lilith' },
    });

    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '❌ nope', components: expect.any(Array) })
    );
    expect(sessionManagerMock.set).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'modal-retry',
        entityId: 'reply-9',
        channelId: '',
        data: { kind: 'seed', values: { name: 'Lilith' } },
      })
    );
  });
});

describe('handleModalRetry', () => {
  const modal = { fake: 'modal' } as unknown as ModalBuilder;

  it('rebuilds the modal with the stashed values and shows it through the timeout catch', async () => {
    sessionManagerMock.findByMessageId.mockResolvedValue({
      userId: 'user-1',
      data: { kind: 'seed', values: { name: 'Lilith' } },
    });
    const rebuild = vi.fn(() => modal);
    const interaction = makeInteraction();

    await handleModalRetry(interaction, rebuild, '/character create');

    expect(sessionManagerMock.findByMessageId).toHaveBeenCalledWith('reply-1');
    expect(rebuild).toHaveBeenCalledWith('seed', { name: 'Lilith' });
    expect(showModalMock).toHaveBeenCalledWith(
      interaction,
      modal,
      expect.objectContaining({ source: 'handleModalRetry', sectionId: 'seed' }),
      expect.any(String)
    );
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('degrades to the session-expired reply when the stash is gone', async () => {
    sessionManagerMock.findByMessageId.mockResolvedValue(null);
    const interaction = makeInteraction();

    await handleModalRetry(interaction, vi.fn(), '/character create');

    expect(showModalMock).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('/character create') })
    );
  });

  it("rejects another user's click on the button", async () => {
    sessionManagerMock.findByMessageId.mockResolvedValue({
      userId: 'someone-else',
      data: { kind: 'seed', values: {} },
    });
    const interaction = makeInteraction();

    await handleModalRetry(interaction, vi.fn(), '/character create');

    expect(showModalMock).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('degrades when no rebuilder exists for the stashed kind', async () => {
    sessionManagerMock.findByMessageId.mockResolvedValue({
      userId: 'user-1',
      data: { kind: 'retired-kind', values: {} },
    });
    const interaction = makeInteraction();

    await handleModalRetry(interaction, () => null, '/character create');

    expect(showModalMock).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalled();
  });
});
