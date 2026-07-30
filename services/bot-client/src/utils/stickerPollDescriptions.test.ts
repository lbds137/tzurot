/**
 * Tests for sticker/poll content descriptions.
 */

import { describe, it, expect } from 'vitest';
import type { Message } from 'discord.js';
import {
  describePoll,
  describeStickers,
  describeStickersAndPoll,
  withStickerAndPollDescriptions,
} from './stickerPollDescriptions.js';

interface StickerFixture {
  name: string;
  description?: string | null;
}

interface AnswerFixture {
  text?: string | null;
  emojiName?: string | null;
}

/**
 * Build the narrow slice of a Message the renderers read. Deliberately not a
 * full Message mock — these functions touch `stickers`, `messageSnapshots`,
 * and `poll` only, and a fixture that mirrors exactly that keeps the test
 * honest about the surface under test.
 */
function messageWith(opts: {
  stickers?: StickerFixture[];
  snapshotStickers?: StickerFixture[][];
  poll?: { question?: string | null; answers?: AnswerFixture[] } | null;
}): Message {
  const toStickerMap = (list: StickerFixture[]): Map<string, unknown> =>
    new Map(
      list.map((s, i) => [
        String(i),
        { name: s.name, description: s.description === undefined ? null : s.description },
      ])
    );

  const poll =
    opts.poll === undefined || opts.poll === null
      ? null
      : {
          question: { text: opts.poll.question === undefined ? 'Q?' : opts.poll.question },
          answers: new Map(
            (opts.poll.answers ?? []).map((a, i) => [
              i,
              {
                text: a.text === undefined ? null : a.text,
                emoji: a.emojiName === undefined ? null : { name: a.emojiName },
              },
            ])
          ),
        };

  return {
    stickers: toStickerMap(opts.stickers ?? []),
    messageSnapshots: new Map(
      (opts.snapshotStickers ?? []).map((list, i) => [String(i), { stickers: toStickerMap(list) }])
    ),
    poll,
  } as unknown as Message;
}

describe('describeStickers', () => {
  it('renders the name alone when Discord supplies no description', () => {
    expect(describeStickers(messageWith({ stickers: [{ name: 'partyblob' }] }))).toBe(
      '[Stickers: partyblob]'
    );
  });

  it('renders name — description when a description exists', () => {
    expect(
      describeStickers(
        messageWith({ stickers: [{ name: 'partyblob', description: 'Blob having a party' }] })
      )
    ).toBe('[Stickers: partyblob — Blob having a party]');
  });

  it('lists every sticker on the message', () => {
    expect(describeStickers(messageWith({ stickers: [{ name: 'one' }, { name: 'two' }] }))).toBe(
      '[Stickers: one, two]'
    );
  });

  it('includes stickers carried by a forwarded message snapshot', () => {
    expect(
      describeStickers(
        messageWith({ stickers: [{ name: 'own' }], snapshotStickers: [[{ name: 'forwarded' }]] })
      )
    ).toBe('[Stickers: own, forwarded]');
  });

  it('flattens newlines so the bracket form stays one line', () => {
    expect(
      describeStickers(messageWith({ stickers: [{ name: 'multi\nline', description: 'a\n\nb' }] }))
    ).toBe('[Stickers: multi line — a b]');
  });

  it('treats an empty-string description as absent', () => {
    expect(describeStickers(messageWith({ stickers: [{ name: 'bare', description: '' }] }))).toBe(
      '[Stickers: bare]'
    );
  });

  it('returns empty string when there are no stickers', () => {
    expect(describeStickers(messageWith({}))).toBe('');
  });
});

describe('describePoll', () => {
  it('renders the question and its options', () => {
    expect(
      describePoll(
        messageWith({
          poll: { question: 'Pizza tonight?', answers: [{ text: 'Yes' }, { text: 'No' }] },
        })
      )
    ).toBe('[Poll: Pizza tonight? — options: Yes, No]');
  });

  it('falls back to the emoji name for an unlabeled option', () => {
    expect(
      describePoll(messageWith({ poll: { question: 'Vibe?', answers: [{ emojiName: 'fire' }] } }))
    ).toBe('[Poll: Vibe? — options: :fire:]');
  });

  it('placeholders an option with neither text nor emoji', () => {
    expect(describePoll(messageWith({ poll: { question: 'Q?', answers: [{}] } }))).toBe(
      '[Poll: Q? — options: (unlabeled option)]'
    );
  });

  it('renders a question-less poll rather than dropping it', () => {
    expect(describePoll(messageWith({ poll: { question: null, answers: [{ text: 'A' }] } }))).toBe(
      '[Poll: (no question) — options: A]'
    );
  });

  it('omits the options clause when the poll has no answers', () => {
    expect(describePoll(messageWith({ poll: { question: 'Lonely?', answers: [] } }))).toBe(
      '[Poll: Lonely?]'
    );
  });

  it('never renders vote counts (they mutate after the fetch; this text persists)', () => {
    const rendered = describePoll(
      messageWith({ poll: { question: 'Q?', answers: [{ text: 'A' }, { text: 'B' }] } })
    );
    expect(rendered).not.toMatch(/\d/);
  });

  it('returns empty string when the message carries no poll', () => {
    expect(describePoll(messageWith({}))).toBe('');
  });
});

describe('describeStickersAndPoll', () => {
  it('returns stickers before the poll, omitting absent shapes', () => {
    expect(
      describeStickersAndPoll(
        messageWith({
          stickers: [{ name: 's' }],
          poll: { question: 'Q?', answers: [{ text: 'A' }] },
        })
      )
    ).toEqual(['[Stickers: s]', '[Poll: Q? — options: A]']);
  });

  it('returns an empty array for a message with neither', () => {
    expect(describeStickersAndPoll(messageWith({}))).toEqual([]);
  });
});

describe('withStickerAndPollDescriptions', () => {
  it('returns the text byte-identical when the message has neither shape', () => {
    expect(withStickerAndPollDescriptions(messageWith({}), 'hello')).toBe('hello');
  });

  it('leaves empty text empty when the message has neither shape', () => {
    expect(withStickerAndPollDescriptions(messageWith({}), '')).toBe('');
  });

  it('appends the description below existing text', () => {
    expect(
      withStickerAndPollDescriptions(messageWith({ stickers: [{ name: 'wave' }] }), 'hi there')
    ).toBe('hi there\n\n[Stickers: wave]');
  });

  it('yields description-only content for a sticker-only message (the drop fix)', () => {
    expect(withStickerAndPollDescriptions(messageWith({ stickers: [{ name: 'wave' }] }), '')).toBe(
      '[Stickers: wave]'
    );
  });

  it('yields description-only content for a poll-only message', () => {
    expect(
      withStickerAndPollDescriptions(
        messageWith({ poll: { question: 'Q?', answers: [{ text: 'A' }] } }),
        ''
      )
    ).toBe('[Poll: Q? — options: A]');
  });
});
