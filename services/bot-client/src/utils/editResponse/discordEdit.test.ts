import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from 'discord.js';
import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { applyEditedChunks, isUneditableError, type EditTarget } from './discordEdit.js';

const { mockStore } = vi.hoisted(() => ({ mockStore: vi.fn() }));

vi.mock('../../redis.js', () => ({
  redisService: { storeWebhookMessage: mockStore },
}));

function apiError(code: number): DiscordAPIError {
  return new DiscordAPIError({ code, message: 'x' }, code, 404, 'PATCH', 'url', {});
}

function liveMessage(id: string) {
  return { id, edit: vi.fn(), delete: vi.fn() };
}

describe('isUneditableError', () => {
  it.each([
    RESTJSONErrorCodes.UnknownWebhook,
    RESTJSONErrorCodes.CannotEditMessageAuthoredByAnotherUser,
    RESTJSONErrorCodes.UnknownMessage,
  ])('is true for Discord code %i', code => {
    expect(isUneditableError(apiError(code))).toBe(true);
  });

  it('is false for other Discord codes and non-Discord errors', () => {
    expect(isUneditableError(apiError(RESTJSONErrorCodes.MissingPermissions))).toBe(false);
    expect(isUneditableError(new Error('boom'))).toBe(false);
  });
});

describe('applyEditedChunks (webhook)', () => {
  const webhook = {
    editMessage: vi.fn(),
    send: vi.fn(),
    deleteMessage: vi.fn(),
  };
  const target: EditTarget = {
    kind: 'webhook',
    webhook: webhook as never,
    threadId: 'thread-1',
    username: 'Lilith',
    avatarURL: 'https://cdn/a.png',
    personalityId: 'pers-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    webhook.send.mockResolvedValue({ id: 'new-1' });
  });

  it('edits each chunk in place with threadId, no attachments and no mentions', async () => {
    const live = [liveMessage('a'), liveMessage('b')] as unknown as Message[];

    const result = await applyEditedChunks(target, live, ['one', 'two']);

    expect(webhook.editMessage).toHaveBeenNthCalledWith(1, 'a', {
      content: 'one',
      threadId: 'thread-1',
      attachments: [],
      allowedMentions: { parse: [] },
    });
    expect(webhook.editMessage).toHaveBeenNthCalledWith(
      2,
      'b',
      expect.objectContaining({ content: 'two' })
    );
    expect(result).toEqual({ ok: true, messageIds: ['a', 'b'] });
  });

  it('sends extra chunks as the same speaker and records them in redis', async () => {
    const live = [liveMessage('a')] as unknown as Message[];

    const result = await applyEditedChunks(target, live, ['one', 'two']);

    expect(webhook.send).toHaveBeenCalledWith({
      content: 'two',
      username: 'Lilith',
      avatarURL: 'https://cdn/a.png',
      threadId: 'thread-1',
      allowedMentions: { parse: [] },
    });
    expect(mockStore).toHaveBeenCalledWith('new-1', 'pers-1');
    expect(result).toEqual({ ok: true, messageIds: ['a', 'new-1'] });
  });

  it('deletes surplus chunks and drops their ids', async () => {
    const live = [liveMessage('a'), liveMessage('b')] as unknown as Message[];

    const result = await applyEditedChunks(target, live, ['only']);

    expect(webhook.deleteMessage).toHaveBeenCalledWith('b', 'thread-1');
    expect(result).toEqual({ ok: true, messageIds: ['a'] });
  });

  it('returns uneditable and changes nothing more when the first edit is refused', async () => {
    webhook.editMessage.mockRejectedValueOnce(apiError(RESTJSONErrorCodes.UnknownWebhook));
    const live = [liveMessage('a'), liveMessage('b')] as unknown as Message[];

    const result = await applyEditedChunks(target, live, ['one']);

    expect(result).toEqual({ ok: false, reason: 'uneditable' });
    expect(webhook.deleteMessage).not.toHaveBeenCalled();
    expect(webhook.send).not.toHaveBeenCalled();
  });

  it('returns error for an unrecognized first-edit failure', async () => {
    webhook.editMessage.mockRejectedValueOnce(new Error('boom'));

    const result = await applyEditedChunks(target, [liveMessage('a')] as unknown as Message[], [
      'x',
    ]);

    expect(result).toEqual({ ok: false, reason: 'error' });
  });

  it('keeps going after a later edit fails and still reports the id', async () => {
    webhook.editMessage.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('late'));
    const live = [liveMessage('a'), liveMessage('b')] as unknown as Message[];

    const result = await applyEditedChunks(target, live, ['one', 'two']);

    expect(result).toEqual({ ok: true, messageIds: ['a', 'b'] });
  });

  it('keeps the id of a surplus chunk that could not be deleted', async () => {
    webhook.deleteMessage.mockRejectedValueOnce(new Error('nope'));
    const live = [liveMessage('a'), liveMessage('b')] as unknown as Message[];

    const result = await applyEditedChunks(target, live, ['one']);

    expect(result).toEqual({ ok: true, messageIds: ['a', 'b'] });
  });
});

describe('applyEditedChunks (dm)', () => {
  const channel = { send: vi.fn() };
  const target: EditTarget = { kind: 'dm', channel: channel as never };

  beforeEach(() => {
    vi.clearAllMocks();
    channel.send.mockResolvedValue({ id: 'dm-new' });
  });

  it('edits live messages directly with no attachments', async () => {
    const a = liveMessage('a');

    const result = await applyEditedChunks(target, [a] as unknown as Message[], ['**N:** hi']);

    expect(a.edit).toHaveBeenCalledWith({
      content: '**N:** hi',
      attachments: [],
      allowedMentions: { parse: [] },
    });
    expect(result).toEqual({ ok: true, messageIds: ['a'] });
  });

  it('sends extras through the channel and deletes surplus messages', async () => {
    const a = liveMessage('a');
    const b = liveMessage('b');

    const grown = await applyEditedChunks(target, [a] as unknown as Message[], ['x', 'y']);
    const shrunk = await applyEditedChunks(target, [a, b] as unknown as Message[], ['x']);

    expect(channel.send).toHaveBeenCalledWith({ content: 'y', allowedMentions: { parse: [] } });
    expect(grown).toEqual({ ok: true, messageIds: ['a', 'dm-new'] });
    expect(b.delete).toHaveBeenCalled();
    expect(shrunk).toEqual({ ok: true, messageIds: ['a'] });
  });
});
