import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from 'discord.js';
import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import {
  applyEditedChunks,
  beginEditedChunks,
  finishEditedChunks,
  isUneditableError,
  restoreEditedChunks,
  type EditTarget,
} from './discordEdit.js';

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
    expect(result).toEqual({ ok: true, messageIds: ['a', 'b'], partial: false });
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
    expect(result).toEqual({ ok: true, messageIds: ['a', 'new-1'], partial: false });
  });

  it('deletes surplus chunks and drops their ids', async () => {
    const live = [liveMessage('a'), liveMessage('b')] as unknown as Message[];

    const result = await applyEditedChunks(target, live, ['only']);

    expect(webhook.deleteMessage).toHaveBeenCalledWith('b', 'thread-1');
    expect(result).toEqual({ ok: true, messageIds: ['a'], partial: false });
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

    expect(result).toEqual({ ok: true, messageIds: ['a', 'b'], partial: true });
  });

  it('omits the id of a later chunk whose edit is refused as uneditable', async () => {
    webhook.editMessage
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(apiError(RESTJSONErrorCodes.UnknownMessage));
    const live = [liveMessage('a'), liveMessage('b')] as unknown as Message[];

    const result = await applyEditedChunks(target, live, ['one', 'two']);

    expect(result).toEqual({ ok: true, messageIds: ['a'], partial: true });
  });

  it('reports partial when an extra chunk send fails', async () => {
    webhook.send.mockRejectedValueOnce(new Error('send failed'));
    const live = [liveMessage('a')] as unknown as Message[];

    const result = await applyEditedChunks(target, live, ['one', 'two', 'three']);

    expect(result).toEqual({ ok: true, messageIds: ['a'], partial: true });
    expect(webhook.send).toHaveBeenCalledTimes(1);
  });

  it('keeps the id of a surplus chunk that could not be deleted', async () => {
    webhook.deleteMessage.mockRejectedValueOnce(new Error('nope'));
    const live = [liveMessage('a'), liveMessage('b')] as unknown as Message[];

    const result = await applyEditedChunks(target, live, ['one']);

    expect(result).toEqual({ ok: true, messageIds: ['a', 'b'], partial: true });
  });
});

describe('applyEditedChunks (dm)', () => {
  const channel = { send: vi.fn() };
  const target: EditTarget = { kind: 'dm', channel: channel as never, personalityId: 'pers-1' };

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
    expect(result).toEqual({ ok: true, messageIds: ['a'], partial: false });
  });

  it('sends extras through the channel and deletes surplus messages', async () => {
    const a = liveMessage('a');
    const b = liveMessage('b');

    const grown = await applyEditedChunks(target, [a] as unknown as Message[], ['x', 'y']);
    const shrunk = await applyEditedChunks(target, [a, b] as unknown as Message[], ['x']);

    expect(channel.send).toHaveBeenCalledWith({ content: 'y', allowedMentions: { parse: [] } });
    expect(mockStore).toHaveBeenCalledWith('dm-new', 'pers-1');
    expect(grown).toEqual({ ok: true, messageIds: ['a', 'dm-new'], partial: false });
    expect(b.delete).toHaveBeenCalled();
    expect(shrunk).toEqual({ ok: true, messageIds: ['a'], partial: false });
  });
});

describe('two-phase edit (begin / finish / restore)', () => {
  const webhook = { editMessage: vi.fn(), send: vi.fn(), deleteMessage: vi.fn() };
  const target: EditTarget = {
    kind: 'webhook',
    webhook: webhook as never,
    threadId: 'thread-1',
    username: 'Lilith',
    avatarURL: 'https://cdn/a.png',
    personalityId: 'pers-1',
  };
  /** The calls made so far, as `verb:id` strings in order, for ordering assertions. */
  let calls: string[];

  /** A live chunk; the last one of a reply carries the TTS attachment. */
  function chunk(id: string, content: string, attachments = 0) {
    return { id, content, attachments: { size: attachments } };
  }
  const original = [
    chunk('a', 'old-a'),
    chunk('b', 'old-b'),
    chunk('c', 'old-c', 1),
  ] as unknown as Message[];

  beforeEach(() => {
    vi.clearAllMocks();
    calls = [];
    let sent = 0;
    webhook.editMessage.mockImplementation(async (id: string, payload: { content?: string }) => {
      calls.push(`edit:${id}:${payload.content ?? '(attachments only)'}`);
    });
    webhook.send.mockImplementation(async () => {
      sent += 1;
      calls.push(`send:new-${sent}`);
      return { id: `new-${sent}` };
    });
    webhook.deleteMessage.mockImplementation(async (id: string) => {
      calls.push(`delete:${id}`);
    });
  });

  it('begin never touches attachments, never deletes, and lists only kept and extra chunks', async () => {
    const begun = await beginEditedChunks(target, original, ['n-a']);

    expect(begun).toEqual(expect.objectContaining({ ok: true, messageIds: ['a'] }));
    expect(calls).toEqual(['edit:a:n-a']);
    for (const [, payload] of webhook.editMessage.mock.calls) {
      expect(payload).not.toHaveProperty('attachments');
    }
  });

  it('grow 1→3 then refuse: the extras are deleted and chunk 1 gets its old text back', async () => {
    const begun = await beginEditedChunks(target, [original[0]], ['n-a', 'n-b', 'n-c']);
    expect(begun).toEqual(
      expect.objectContaining({ ok: true, messageIds: ['a', 'new-1', 'new-2'] })
    );

    const restored = await restoreEditedChunks(target, begun as never);

    expect(restored).toBe(true);
    expect(calls).toEqual([
      'edit:a:n-a',
      'send:new-1',
      'send:new-2',
      'edit:a:old-a',
      'delete:new-1',
      'delete:new-2',
    ]);
  });

  it('shrink 3→1 then refuse: all three originals still exist with their text, nothing is re-sent', async () => {
    const begun = await beginEditedChunks(target, original, ['n-a']);

    const restored = await restoreEditedChunks(target, begun as never);

    expect(restored).toBe(true);
    expect(webhook.deleteMessage).not.toHaveBeenCalled();
    expect(webhook.send).not.toHaveBeenCalled();
    expect(calls).toEqual(['edit:a:n-a', 'edit:a:old-a']);
  });

  it('shrink 3→1 then commit: surplus is deleted and the attachment cleared only in finish', async () => {
    const begun = await beginEditedChunks(target, original, ['n-a']);
    const beforeFinish = [...calls];

    const finished = await finishEditedChunks(target, begun as never);

    expect(beforeFinish).toEqual(['edit:a:n-a']);
    expect(finished).toEqual({ ok: true, survivorIds: [] });
    expect(calls).toEqual(['edit:a:n-a', 'delete:b', 'delete:c']);
  });

  it('equal count: the attachment stays until finish, which then clears it on the carrying chunk only', async () => {
    const begun = await beginEditedChunks(target, original, ['n-a', 'n-b', 'n-c']);
    expect(calls).toEqual(['edit:a:n-a', 'edit:b:n-b', 'edit:c:n-c']);
    for (const [, payload] of webhook.editMessage.mock.calls) {
      expect(payload).not.toHaveProperty('attachments');
    }

    await finishEditedChunks(target, begun as never);

    expect(calls.slice(3)).toEqual(['edit:c:(attachments only)']);
    expect(webhook.editMessage).toHaveBeenLastCalledWith(
      'c',
      expect.objectContaining({ attachments: [], threadId: 'thread-1' })
    );
  });

  it('finish reports a surplus chunk it could not delete as a survivor, without throwing', async () => {
    const begun = await beginEditedChunks(target, original, ['n-a']);
    webhook.deleteMessage.mockRejectedValueOnce(new Error('nope'));

    const finished = await finishEditedChunks(target, begun as never);

    expect(finished).toEqual({ ok: false, survivorIds: ['b'] });
  });

  it('restore reports false (and keeps going) when an edit back is refused', async () => {
    const begun = await beginEditedChunks(target, original, ['n-a']);
    webhook.editMessage.mockRejectedValueOnce(new Error('nope'));

    expect(await restoreEditedChunks(target, begun as never)).toBe(false);
  });

  describe('idempotence: a message already gone is skipped, not an error', () => {
    const gone = () => apiError(RESTJSONErrorCodes.UnknownMessage);

    it('restore skips an overlap chunk and an extra that no longer exist, and still reports true', async () => {
      const begun = await beginEditedChunks(target, [original[0]], ['n-a', 'n-b']);
      webhook.editMessage.mockRejectedValueOnce(gone());
      webhook.deleteMessage.mockRejectedValueOnce(gone());

      expect(await restoreEditedChunks(target, begun as never)).toBe(true);
    });

    it('restoring twice is harmless: the second run edits back the same text and finds the extra gone', async () => {
      const begun = await beginEditedChunks(target, [original[0]], ['n-a', 'n-b']);
      await restoreEditedChunks(target, begun as never);
      webhook.deleteMessage.mockRejectedValueOnce(gone());

      expect(await restoreEditedChunks(target, begun as never)).toBe(true);
      expect(calls.filter(call => call === 'edit:a:old-a')).toHaveLength(2);
    });

    it('a restore failure that is not a gone message still reports false', async () => {
      const begun = await beginEditedChunks(target, [original[0]], ['n-a', 'n-b']);
      webhook.deleteMessage.mockRejectedValueOnce(apiError(RESTJSONErrorCodes.MissingPermissions));

      expect(await restoreEditedChunks(target, begun as never)).toBe(false);
    });

    it('finish skips a surplus chunk that is already gone (no survivor, ok)', async () => {
      const begun = await beginEditedChunks(target, original, ['n-a']);
      webhook.deleteMessage.mockRejectedValueOnce(gone());

      expect(await finishEditedChunks(target, begun as never)).toEqual({
        ok: true,
        survivorIds: [],
      });
      expect(webhook.deleteMessage).toHaveBeenCalledTimes(2);
    });

    it('finish skips an attachment clear on a chunk that is already gone', async () => {
      const begun = await beginEditedChunks(target, original, ['n-a', 'n-b', 'n-c']);
      webhook.editMessage.mockRejectedValueOnce(gone());

      expect(await finishEditedChunks(target, begun as never)).toEqual({
        ok: true,
        survivorIds: [],
      });
    });
  });

  it('reports each extra to the callback as soon as it is sent, before the next is sent', async () => {
    const seen: string[] = [];
    await beginEditedChunks(target, [original[0]], ['n-a', 'n-b', 'n-c'], 'keep', async id => {
      seen.push(`${id}@${calls.join(',')}`);
    });

    expect(seen).toEqual(['new-1@edit:a:n-a,send:new-1', 'new-2@edit:a:n-a,send:new-1,send:new-2']);
  });

  it('a failing callback never fails the edit', async () => {
    const begun = await beginEditedChunks(target, [original[0]], ['n-a', 'n-b'], 'keep', () =>
      Promise.reject(new Error('redis down'))
    );

    expect(begun).toEqual(expect.objectContaining({ ok: true, messageIds: ['a', 'new-1'] }));
  });
});
