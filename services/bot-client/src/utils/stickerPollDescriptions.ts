/**
 * Sticker and poll descriptions for model context.
 *
 * Neither shape carries text in `message.content`, so a sticker-only or
 * poll-only message reaches the model as an empty string — and the extended
 * context fetcher's `hasProcessableContent` gate DROPS it outright, leaving a
 * hole in the conversation the character can't see. These renderers turn both
 * shapes into a one-line text description, in the same bracketed style as the
 * `[Attachments: …]` line, so they ride the ordinary content path (persisted
 * with the history row, no metadata plumbing, no prompt-format change).
 *
 * Deliberate omissions:
 * - **Poll vote counts.** They mutate after the fetch, and this text is
 *   persisted — a frozen tally would be wrong forever. The question and the
 *   options are the poll's semantic content; the tally is volatile state.
 *
 * These renderers cover EVERY sticker, including ones `stickerAttachments.ts`
 * also sends down the vision path for a real image description. That overlap is
 * deliberate, not redundancy to clean up: this line is what makes a
 * sticker-only message non-empty, and `EmptyMessageFilter` drops a message with
 * no content before any trigger processor runs. Rendering only the
 * un-describable stickers here would re-open exactly that hole for the
 * describable ones whenever vision is disabled or fails.
 */

import type { Message, MessageSnapshot, Sticker } from 'discord.js';

/** Collapse newlines so a description can't break the one-line bracket form. */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Read a Discord.js Collection's values, tolerating an absent one.
 *
 * `MessageSnapshot` is a `Partialize<Message>`, so a snapshot-shaped object
 * reaching these renderers may genuinely lack a field the `Message` type
 * declares as always-present. These descriptions are decoration on the
 * message-handling hot path — throwing here would kill an entire turn to
 * render a sticker label, which is never the right trade.
 */
function collectionValues<T>(collection: { values(): Iterable<T> } | undefined | null): T[] {
  return collection === undefined || collection === null ? [] : [...collection.values()];
}

/** `name` alone, or `name — description` when Discord supplies a description. */
function describeSticker(sticker: Sticker): string {
  const name = flatten(sticker.name);
  const description =
    sticker.description === null || sticker.description.length === 0
      ? undefined
      : flatten(sticker.description);
  return description === undefined ? name : `${name} — ${description}`;
}

/**
 * `[Stickers: …]` for every sticker on the message, including any carried by a
 * forwarded message's snapshots (snapshots retain `stickers`; they never carry
 * a poll). Empty string when there are none, so callers can push
 * unconditionally and filter falsy.
 */
export function describeStickers(message: Message): string {
  const all = collectAllStickers(message);
  if (all.length === 0) {
    return '';
  }
  return `[Stickers: ${all.map(describeSticker).join(', ')}]`;
}

/**
 * Every sticker on a message: its own, plus any carried by a forwarded
 * message's snapshots.
 *
 * Exported because `stickerAttachments.ts` needs the identical set — one walk
 * of the snapshot structure, so the text rendering and the vision injection can
 * never disagree about which stickers a message carries.
 */
export function collectAllStickers(message: Message): Sticker[] {
  const own = collectionValues<Sticker>(message.stickers);
  const snapshots = collectionValues<MessageSnapshot>(message.messageSnapshots);
  const forwarded = snapshots.flatMap(snapshot => collectionValues<Sticker>(snapshot.stickers));
  return [...own, ...forwarded];
}

/**
 * The bits of a poll answer this renderer reads. Structural rather than
 * `PollAnswer` so it also accepts `PartialPollAnswer` (both carry these two)
 * without a union or a cast.
 */
interface PollAnswerLike {
  text: string | null;
  emoji: { name: string | null } | null;
}

/**
 * Read `message.poll`, normalizing an absent field to null. The `?? null` does
 * runtime work the types call redundant: discord.js declares `poll` as
 * `Poll | null` (never undefined), but a partial-shaped message can omit the
 * field entirely — the same case collectionValues covers.
 */
function pollOf(message: Message): Message['poll'] {
  return message.poll ?? null;
}

/** One poll answer's label: its text, else its emoji name, else a placeholder. */
function describeAnswer(answer: PollAnswerLike): string {
  if (answer.text !== null && answer.text.length > 0) {
    return flatten(answer.text);
  }
  const emojiName = answer.emoji?.name;
  return emojiName !== null && emojiName !== undefined ? `:${emojiName}:` : '(unlabeled option)';
}

/**
 * `[Poll: question — options: a, b, c]`. Empty string when the message carries
 * no poll. A poll with neither a question nor answers still renders (the fact
 * that a poll was posted is itself the content the character would otherwise
 * miss entirely).
 */
export function describePoll(message: Message): string {
  const poll = pollOf(message);
  if (poll === null) {
    return '';
  }
  const question =
    poll.question.text === null || poll.question.text.length === 0
      ? '(no question)'
      : flatten(poll.question.text);
  const answers = [...poll.answers.values()].map(describeAnswer);
  const options = answers.length === 0 ? '' : ` — options: ${answers.join(', ')}`;
  return `[Poll: ${question}${options}]`;
}

/**
 * Both descriptions for a message, in the order they should read. Callers
 * append these to the message's text content.
 */
export function describeStickersAndPoll(message: Message): string[] {
  return [describeStickers(message), describePoll(message)].filter(part => part.length > 0);
}

/**
 * Whether the message carries either shape — i.e. whether
 * {@link describeStickersAndPoll} would produce anything.
 *
 * `hasMessageContent` needs this WITHOUT building the description strings: it
 * runs as a pre-filter over every message in a fetched batch, and a message it
 * rejects never reaches the renderers at all. The two must agree exactly or a
 * message gets filtered out as empty and then would have rendered content —
 * a `describeStickersAndPoll`-vs-this equivalence test pins that.
 */
export function hasStickerOrPoll(message: Message): boolean {
  const ownStickers = collectionValues<Sticker>(message.stickers).length > 0;
  const snapshotStickers = collectionValues<MessageSnapshot>(message.messageSnapshots).some(
    snapshot => collectionValues<Sticker>(snapshot.stickers).length > 0
  );
  return ownStickers || snapshotStickers || pollOf(message) !== null;
}

/**
 * Append the descriptions to already-resolved message text, joined the way
 * {@link describeStickersAndPoll}'s callers join content parts. Returns `text`
 * unchanged when the message carries neither shape — so a text-only message's
 * content is never rewritten (byte-identical, including empty).
 */
export function withStickerAndPollDescriptions(message: Message, text: string): string {
  const parts = describeStickersAndPoll(message);
  if (parts.length === 0) {
    return text;
  }
  return [...(text.length > 0 ? [text] : []), ...parts].join('\n\n');
}
