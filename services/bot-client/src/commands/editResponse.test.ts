import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType, DiscordAPIError, MessageFlags, RESTJSONErrorCodes } from 'discord.js';
import {
  EDIT_RESPONSE_MAX_CONTENT_LENGTH,
  buildModelFooterText,
} from '@tzurot/common-types/constants/discord';
import editResponse from './editResponse.js';

const mocks = vi.hoisted(() => ({
  getEditableMessage: vi.fn(),
  checkEditAssistantMessage: vi.fn(),
  editAssistantMessage: vi.fn(),
  getWebhook: vi.fn(),
  storeWebhookMessage: vi.fn(),
}));

vi.mock('../utils/gatewayClients.js', () => ({
  clientsFor: () => ({
    userClient: {
      getEditableMessage: mocks.getEditableMessage,
      checkEditAssistantMessage: mocks.checkEditAssistantMessage,
      editAssistantMessage: mocks.editAssistantMessage,
    },
  }),
}));
vi.mock('../services/serviceRegistry.js', () => ({
  getWebhookManager: () => ({ getWebhook: mocks.getWebhook }),
}));
vi.mock('../redis.js', () => ({
  redisService: { storeWebhookMessage: mocks.storeWebhookMessage },
}));

const MODEL_LINE = `-# ${buildModelFooterText('x/y', 'https://openrouter.ai/x/y', {})}`;

interface FakeChunk {
  id: string;
  webhookId: string | null;
  content: string;
  author: { id: string; username: string; displayAvatarURL: () => string };
  edit: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function chunk(id: string, content: string, webhookId: string | null = 'wh-1'): FakeChunk {
  return {
    id,
    webhookId,
    content,
    author: { id: 'author', username: 'Lilith', displayAvatarURL: () => 'https://cdn/a.png' },
    edit: vi.fn(),
    delete: vi.fn(),
  };
}

function modalInteraction(text: string, chunks: FakeChunk[], channelOverrides = {}) {
  const channel = {
    type: ChannelType.GuildText,
    id: 'chan-1',
    isTextBased: () => true,
    isThread: () => false,
    isDMBased: () => false,
    send: vi.fn().mockResolvedValue({ id: 'dm-new' }),
    messages: {
      fetch: vi.fn(async (id: string) => {
        const found = chunks.find(c => c.id === id);
        if (found === undefined) {
          throw new Error('gone');
        }
        return found;
      }),
    },
    ...channelOverrides,
  };
  const interaction = {
    customId: 'edit-response::submit::chan-1::m1',
    user: { id: 'u1' },
    deferred: false,
    replied: false,
    ephemeral: true,
    deferReply: vi.fn(async () => {
      interaction.deferred = true;
    }),
    editReply: vi.fn(),
    followUp: vi.fn(),
    reply: vi.fn(),
    fields: { getTextInputValue: vi.fn().mockReturnValue(text) },
    client: { channels: { fetch: vi.fn().mockResolvedValue(channel) } },
  };
  return { channel, interaction };
}

function webhookStub() {
  return {
    id: 'wh-1',
    editMessage: vi.fn(),
    send: vi.fn().mockResolvedValue({ id: 'new-1' }),
    deleteMessage: vi.fn(),
  };
}

function lastReply(interaction: { editReply: ReturnType<typeof vi.fn> }): string {
  return (interaction.editReply.mock.calls.at(-1)?.[0] as { content: string }).content;
}

const handleModal = editResponse.handleModal as NonNullable<typeof editResponse.handleModal>;

describe('Edit Response — definition', () => {
  it('is a modal-mode message context menu named Edit Response', () => {
    expect(editResponse.data.name).toBe('Edit Response');
    expect(editResponse.deferralMode).toBe('modal');
    expect(editResponse.modalPrefix).toBe('edit-response');
  });
});

describe('Edit Response — open', () => {
  function openInteraction(target: Record<string, unknown>) {
    return {
      targetMessage: { id: 'm1', webhookId: 'wh-1', author: { id: 'someone' }, ...target },
      client: { user: { id: 'bot-1' } },
      channelId: 'chan-1',
      user: { id: 'u1' },
      deferred: false,
      replied: false,
      reply: vi.fn(),
      editReply: vi.fn(),
      followUp: vi.fn(),
      showModal: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replies ephemerally and skips the gateway for a non-character message', async () => {
    const interaction = openInteraction({ webhookId: null });

    await editResponse.execute(interaction as never);

    expect(mocks.getEditableMessage).not.toHaveBeenCalled();
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("isn't from a character"),
        flags: MessageFlags.Ephemeral,
      })
    );
  });

  it('shows an ephemeral error and no modal on a gateway 404', async () => {
    mocks.getEditableMessage.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'nf',
      kind: 'http',
    });
    const interaction = openInteraction({});

    await editResponse.execute(interaction as never);

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("isn't one of your character replies"),
        flags: MessageFlags.Ephemeral,
      })
    );
  });

  it('replies with the classified transient spec, not "not yours", on a non-404 lookup failure', async () => {
    mocks.getEditableMessage.mockResolvedValue({
      ok: false,
      status: 0,
      error: 'timed out',
      kind: 'timeout',
    });
    const interaction = openInteraction({});

    await editResponse.execute(interaction as never);

    expect(interaction.showModal).not.toHaveBeenCalled();
    const { content } = interaction.reply.mock.calls[0][0] as { content: string };
    expect(content).toContain("Couldn't load the response right now. Please try again later.");
    expect(content).not.toContain("isn't one of your character replies");
  });

  it('does not report "not yours" for an HTTP 503 lookup failure', async () => {
    mocks.getEditableMessage.mockResolvedValue({
      ok: false,
      status: 503,
      error: 'upstream unavailable',
      kind: 'http',
    });
    const interaction = openInteraction({});

    await editResponse.execute(interaction as never);

    expect(interaction.showModal).not.toHaveBeenCalled();
    const { content } = interaction.reply.mock.calls[0][0] as { content: string };
    expect(content).not.toContain("isn't one of your character replies");
  });

  it('refuses a response longer than the edit limit', async () => {
    mocks.getEditableMessage.mockResolvedValue({
      ok: true,
      data: {
        content: 'a'.repeat(EDIT_RESPONSE_MAX_CONTENT_LENGTH + 1),
        discordMessageIds: ['m1'],
        personalityId: 'p1',
        memorySync: { kind: 'sync' },
      },
    });
    const interaction = openInteraction({});

    await editResponse.execute(interaction as never);

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('too long') })
    );
  });

  it('refuses to open the modal for a locked memory', async () => {
    mocks.getEditableMessage.mockResolvedValue({
      ok: true,
      data: {
        content: 'stored reply',
        discordMessageIds: ['m1'],
        personalityId: 'p1',
        memorySync: { kind: 'blocked', reason: 'locked' },
      },
    });
    const interaction = openInteraction({});

    await editResponse.execute(interaction as never);

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('memory is locked') })
    );
  });

  it('refuses to open the modal when the memory cannot be updated safely', async () => {
    mocks.getEditableMessage.mockResolvedValue({
      ok: true,
      data: {
        content: 'stored reply',
        discordMessageIds: ['m1'],
        personalityId: 'p1',
        memorySync: { kind: 'blocked', reason: 'chunked' },
      },
    });
    const interaction = openInteraction({});

    await editResponse.execute(interaction as never);

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("can't be updated safely") })
    );
  });

  it('replies with a classified failure and no modal when the lookup throws', async () => {
    mocks.getEditableMessage.mockRejectedValue(new Error('gateway down'));
    const interaction = openInteraction({});

    await editResponse.execute(interaction as never);

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral })
    );
  });

  it('shows the modal prefilled with the stored text', async () => {
    mocks.getEditableMessage.mockResolvedValue({
      ok: true,
      data: {
        content: 'stored reply',
        discordMessageIds: ['m1'],
        personalityId: 'p1',
        memorySync: { kind: 'sync' },
      },
    });
    const interaction = openInteraction({});

    await editResponse.execute(interaction as never);

    expect(mocks.getEditableMessage).toHaveBeenCalledWith('m1');
    const modal = interaction.showModal.mock.calls[0][0].toJSON();
    expect(modal.custom_id).toBe('edit-response::submit::chan-1::m1');
    expect(modal.title).toBe('Edit Response');
    expect(modal.components[0].component).toMatchObject({
      value: 'stored reply',
      max_length: EDIT_RESPONSE_MAX_CONTENT_LENGTH,
      required: true,
    });
  });
});

describe('Edit Response — submit', () => {
  const okLookup = (ids: string[], memorySync: Record<string, string> = { kind: 'sync' }) => ({
    ok: true,
    data: { content: 'old', discordMessageIds: ids, personalityId: 'p1', memorySync },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.editAssistantMessage.mockResolvedValue({
      ok: true,
      data: { edited: true, memory: { kind: 'synced' } },
    });
  });

  it('defers first, then runs a failed pre-check with zero Discord mutations and no PATCH', async () => {
    const wh = webhookStub();
    mocks.getWebhook.mockResolvedValue(wh);
    mocks.checkEditAssistantMessage.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'nf',
      kind: 'http',
    });
    const chunks = [chunk('m1', 'old')];
    const { interaction, channel } = modalInteraction('new', chunks);

    await handleModal(interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(channel.messages.fetch).not.toHaveBeenCalled();
    expect(wh.editMessage).not.toHaveBeenCalled();
    expect(wh.send).not.toHaveBeenCalled();
    expect(wh.deleteMessage).not.toHaveBeenCalled();
    expect(mocks.editAssistantMessage).not.toHaveBeenCalled();
    expect(lastReply(interaction)).toContain("isn't one of your character replies");
  });

  it('rejects empty text without touching the gateway', async () => {
    const { interaction } = modalInteraction('   ', [chunk('m1', 'old')]);

    await handleModal(interaction as never);

    expect(mocks.checkEditAssistantMessage).not.toHaveBeenCalled();
    expect(lastReply(interaction)).toContain('cannot be empty');
  });

  it('does not mutate or PATCH when a live chunk belongs to another webhook', async () => {
    const wh = webhookStub();
    mocks.getWebhook.mockResolvedValue(wh);
    mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1']));
    const { interaction } = modalInteraction('new', [chunk('m1', 'old', 'other-webhook')]);

    await handleModal(interaction as never);

    expect(wh.editMessage).not.toHaveBeenCalled();
    expect(mocks.editAssistantMessage).not.toHaveBeenCalled();
    expect(lastReply(interaction)).toContain("can't edit this message anymore");
  });

  it('does not mutate or PATCH when a chunk can no longer be fetched', async () => {
    const wh = webhookStub();
    mocks.getWebhook.mockResolvedValue(wh);
    mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1', 'm2']));
    const { interaction } = modalInteraction('new', [chunk('m1', 'old')]);

    await handleModal(interaction as never);

    expect(wh.editMessage).not.toHaveBeenCalled();
    expect(mocks.editAssistantMessage).not.toHaveBeenCalled();
    expect(lastReply(interaction)).toContain("can't edit this message anymore");
  });

  it('short-circuits an unchanged submit with no Discord call and no PATCH', async () => {
    const wh = webhookStub();
    mocks.getWebhook.mockResolvedValue(wh);
    mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1']));
    const { interaction, channel } = modalInteraction('old', [chunk('m1', `old\n${MODEL_LINE}`)]);

    await handleModal(interaction as never);

    expect(lastReply(interaction)).toContain('No changes to save.');
    expect(channel.messages.fetch).not.toHaveBeenCalled();
    expect(wh.editMessage).not.toHaveBeenCalled();
    expect(wh.send).not.toHaveBeenCalled();
    expect(wh.deleteMessage).not.toHaveBeenCalled();
    expect(mocks.editAssistantMessage).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only difference as an edit (text is stored as typed)', async () => {
    const wh = webhookStub();
    mocks.getWebhook.mockResolvedValue(wh);
    mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1']));
    const { interaction } = modalInteraction('old ', [chunk('m1', `old\n${MODEL_LINE}`)]);

    await handleModal(interaction as never);

    expect(wh.editMessage).toHaveBeenCalledTimes(1);
    expect(mocks.editAssistantMessage).toHaveBeenCalledWith('m1', {
      content: 'old ',
      discordMessageIds: ['m1'],
    });
  });

  it('edits each chunk in place, reattaches the footer and PATCHes the same ids', async () => {
    const wh = webhookStub();
    mocks.getWebhook.mockResolvedValue(wh);
    mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1']));
    const { interaction } = modalInteraction('new text', [chunk('m1', `old\n${MODEL_LINE}`)], {
      isThread: () => true,
      id: 'thread-9',
    });

    await handleModal(interaction as never);

    expect(wh.editMessage).toHaveBeenCalledWith('m1', {
      content: `new text\n${MODEL_LINE}`,
      threadId: 'thread-9',
      attachments: [],
      allowedMentions: { parse: [] },
    });
    expect(mocks.editAssistantMessage).toHaveBeenCalledWith('m1', {
      content: 'new text',
      discordMessageIds: ['m1'],
    });
    expect(lastReply(interaction)).toBe('✅ Response edited.');
  });

  it('sends extra chunks, records them and appends their ids when the text grows', async () => {
    const wh = webhookStub();
    mocks.getWebhook.mockResolvedValue(wh);
    mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1']));
    const long = `${'a'.repeat(1500)}\n${'b'.repeat(1500)}`;
    const { interaction } = modalInteraction(long, [chunk('m1', 'old')]);

    await handleModal(interaction as never);

    expect(wh.send).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'Lilith', avatarURL: 'https://cdn/a.png' })
    );
    expect(mocks.storeWebhookMessage).toHaveBeenCalledWith('new-1', 'p1');
    expect(mocks.editAssistantMessage).toHaveBeenCalledWith('m1', {
      content: long,
      discordMessageIds: ['m1', 'new-1'],
    });
  });

  it('deletes surplus chunks and trims the ids when the text shrinks', async () => {
    const wh = webhookStub();
    mocks.getWebhook.mockResolvedValue(wh);
    mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1', 'm2']));
    const { interaction } = modalInteraction('short', [
      chunk('m1', 'old one'),
      chunk('m2', 'old two'),
    ]);

    await handleModal(interaction as never);

    expect(wh.deleteMessage).toHaveBeenCalledWith('m2', undefined);
    expect(mocks.editAssistantMessage).toHaveBeenCalledWith('m1', {
      content: 'short',
      discordMessageIds: ['m1'],
    });
  });

  it('replies with the partial text and stores the surviving ids when a surplus delete fails', async () => {
    const wh = webhookStub();
    wh.deleteMessage.mockRejectedValueOnce(new Error('nope'));
    mocks.getWebhook.mockResolvedValue(wh);
    mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1', 'm2']));
    const { interaction } = modalInteraction('short', [
      chunk('m1', 'old one'),
      chunk('m2', 'old two'),
    ]);

    await handleModal(interaction as never);

    expect(mocks.editAssistantMessage).toHaveBeenCalledWith('m1', {
      content: 'short',
      discordMessageIds: ['m1', 'm2'],
    });
    expect(lastReply(interaction)).toBe(
      "✅ Response edited, but part of it couldn't be updated on Discord."
    );
  });

  it('keeps the DM speaker prefix on chunk 0 and edits through the message', async () => {
    mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1']));
    const dm = chunk('m1', '**Lilith:** old', null);
    const { interaction } = modalInteraction('new', [dm], {
      type: ChannelType.DM,
      isDMBased: () => true,
    });

    await handleModal(interaction as never);

    expect(dm.edit).toHaveBeenCalledWith({
      content: '**Lilith:** new',
      attachments: [],
      allowedMentions: { parse: [] },
    });
    expect(mocks.getWebhook).not.toHaveBeenCalled();
    expect(mocks.editAssistantMessage).toHaveBeenCalledWith('m1', {
      content: 'new',
      discordMessageIds: ['m1'],
    });
  });

  it('refuses a non-webhook message in a guild channel without mutating or PATCHing', async () => {
    mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1']));
    const other = chunk('m1', 'old', null);
    const { interaction } = modalInteraction('new', [other]);

    await handleModal(interaction as never);

    expect(other.edit).not.toHaveBeenCalled();
    expect(mocks.editAssistantMessage).not.toHaveBeenCalled();
    expect(lastReply(interaction)).toContain("can't edit this message anymore");
  });

  it.each([
    [{ kind: 'blocked', reason: 'locked' }, 'memory is locked. Unlock it in /memory to edit.'],
    [{ kind: 'blocked', reason: 'chunked' }, "memory can't be updated safely"],
    [{ kind: 'blocked', reason: 'ambiguous' }, "memory can't be updated safely"],
    [{ kind: 'blocked', reason: 'off-template' }, "memory can't be updated safely"],
  ])(
    'refuses a blocked memory (%o) before any Discord fetch or mutation',
    async (memorySync, expected) => {
      const wh = webhookStub();
      mocks.getWebhook.mockResolvedValue(wh);
      mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1'], memorySync));
      const { interaction, channel } = modalInteraction('new', [chunk('m1', 'old')]);

      await handleModal(interaction as never);

      expect(channel.messages.fetch).not.toHaveBeenCalled();
      expect(wh.editMessage).not.toHaveBeenCalled();
      expect(mocks.editAssistantMessage).not.toHaveBeenCalled();
      expect(lastReply(interaction)).toContain(expected);
    }
  );

  it('refuses a reply the gateway says cannot be stored, naming the separator', async () => {
    const wh = webhookStub();
    mocks.getWebhook.mockResolvedValue(wh);
    mocks.checkEditAssistantMessage.mockResolvedValue(
      okLookup(['m1'], { kind: 'blocked', reason: 'reply-off-template' })
    );
    const { interaction, channel } = modalInteraction('a\n{assistant}: b', [chunk('m1', 'old')]);

    await handleModal(interaction as never);

    expect(channel.messages.fetch).not.toHaveBeenCalled();
    expect(wh.editMessage).not.toHaveBeenCalled();
    expect(mocks.editAssistantMessage).not.toHaveBeenCalled();
    expect(lastReply(interaction)).toContain('"{assistant}:"');
  });

  it('sends the submitted text to the edit-check call, not the plain lookup', async () => {
    const wh = webhookStub();
    mocks.getWebhook.mockResolvedValue(wh);
    mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1'], { kind: 'none' }));
    const { interaction } = modalInteraction('a\n{assistant}: b', [chunk('m1', 'old')]);

    await handleModal(interaction as never);

    expect(mocks.checkEditAssistantMessage).toHaveBeenCalledWith('m1', {
      content: 'a\n{assistant}: b',
    });
    expect(mocks.getEditableMessage).not.toHaveBeenCalled();
    expect(mocks.editAssistantMessage).toHaveBeenCalled();
  });

  it('passes the thread id when the reply lives in a thread', async () => {
    const wh = webhookStub();
    mocks.getWebhook.mockResolvedValue(wh);
    mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1']));
    const { interaction } = modalInteraction('new', [chunk('m1', 'old')], {
      type: ChannelType.PublicThread,
      isThread: () => true,
      id: 'thread-7',
    });

    await handleModal(interaction as never);

    expect(wh.editMessage).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ threadId: 'thread-7' })
    );
  });

  it('ignores a modal submit whose custom id is not a submit action', async () => {
    const { interaction } = modalInteraction('new', [chunk('m1', 'old')]);
    interaction.customId = 'edit-response::bogus';

    await handleModal(interaction as never);

    expect(mocks.checkEditAssistantMessage).not.toHaveBeenCalled();
    expect(mocks.editAssistantMessage).not.toHaveBeenCalled();
    expect(lastReply(interaction)).toContain('Something went wrong editing the response.');
  });

  it('refuses without creating a webhook when the channel is not webhook-capable', async () => {
    mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1']));
    const { interaction } = modalInteraction('new', [chunk('m1', 'old')], {
      type: ChannelType.GuildVoice,
    });

    await handleModal(interaction as never);

    expect(mocks.getWebhook).not.toHaveBeenCalled();
    expect(mocks.editAssistantMessage).not.toHaveBeenCalled();
    expect(lastReply(interaction)).toContain("can't edit this message anymore");
  });

  it('refuses a non-webhook message in a channel that cannot send', async () => {
    mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1']));
    const other = chunk('m1', 'old', null);
    const { interaction } = modalInteraction('new', [other], { send: undefined });

    await handleModal(interaction as never);

    expect(other.edit).not.toHaveBeenCalled();
    expect(mocks.editAssistantMessage).not.toHaveBeenCalled();
    expect(lastReply(interaction)).toContain("can't edit this message anymore");
  });

  it('refuses without mutating when the webhook cannot be resolved', async () => {
    mocks.getWebhook.mockRejectedValue(new Error('Missing Permissions'));
    mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1']));
    const { interaction } = modalInteraction('new', [chunk('m1', 'old')]);

    await handleModal(interaction as never);

    expect(mocks.editAssistantMessage).not.toHaveBeenCalled();
    expect(lastReply(interaction)).toContain("can't edit this message anymore");
  });

  it('replies with the classified failure when the submit handler throws', async () => {
    mocks.checkEditAssistantMessage.mockRejectedValue(new Error('boom'));
    const { interaction } = modalInteraction('new', [chunk('m1', 'old')]);

    await handleModal(interaction as never);

    expect(mocks.editAssistantMessage).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'failed' }, false],
    [{ kind: 'blocked', reason: 'locked' }, false],
    [{ kind: 'failed' }, true],
  ])('says the memory was not updated when the PATCH reports %o', async (memory, partial) => {
    const wh = webhookStub();
    if (partial) {
      wh.deleteMessage.mockRejectedValueOnce(new Error('nope'));
    }
    mocks.getWebhook.mockResolvedValue(wh);
    mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(partial ? ['m1', 'm2'] : ['m1']));
    mocks.editAssistantMessage.mockResolvedValue({ ok: true, data: { edited: true, memory } });
    const chunks = partial ? [chunk('m1', 'a'), chunk('m2', 'b')] : [chunk('m1', 'a')];
    const { interaction } = modalInteraction('short', chunks);

    await handleModal(interaction as never);

    const reply = lastReply(interaction);
    expect(reply).toContain("the character's memory couldn't be updated to match");
    expect(reply).not.toBe('✅ Response edited.');
    expect(reply.includes('part of it')).toBe(partial);
  });

  it('does not PATCH when Discord refuses the first edit as UnknownWebhook', async () => {
    const wh = webhookStub();
    wh.editMessage.mockRejectedValue(
      new DiscordAPIError(
        { code: RESTJSONErrorCodes.UnknownWebhook, message: 'x' },
        RESTJSONErrorCodes.UnknownWebhook,
        404,
        'PATCH',
        'url',
        {}
      )
    );
    mocks.getWebhook.mockResolvedValue(wh);
    mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1']));
    const { interaction } = modalInteraction('new', [chunk('m1', 'old')]);

    await handleModal(interaction as never);

    expect(mocks.editAssistantMessage).not.toHaveBeenCalled();
    expect(lastReply(interaction)).toContain("can't edit this message anymore");
  });

  it.each([500, 404])(
    'reports a failed history update (status %i) after Discord was edited',
    async status => {
      const wh = webhookStub();
      mocks.getWebhook.mockResolvedValue(wh);
      mocks.checkEditAssistantMessage.mockResolvedValue(okLookup(['m1']));
      mocks.editAssistantMessage.mockResolvedValue({
        ok: false,
        status,
        error: 'down',
        kind: 'http',
      });
      const { interaction } = modalInteraction('new', [chunk('m1', 'old')]);

      await handleModal(interaction as never);

      expect(wh.editMessage).toHaveBeenCalled();
      expect(lastReply(interaction)).toContain(
        "The message was edited on Discord, but the change couldn't be saved, so the character may not remember it."
      );
    }
  );
});
