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
 * - **Sticker images.** Stickers are not attachments and never reach the
 *   vision path; the name (and description, when Discord supplies one) is all
 *   the semantic signal available without downloading the asset.
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
export function describeStickers(message: Message | MessageSnapshot): string {
  const own = collectionValues<Sticker>(message.stickers);
  const snapshots =
    'messageSnapshots' in message
      ? collectionValues<MessageSnapshot>(message.messageSnapshots)
      : [];
  const forwarded = snapshots.flatMap(snapshot => collectionValues<Sticker>(snapshot.stickers));
  const all = [...own, ...forwarded];
  if (all.length === 0) {
    return '';
  }
  return `[Stickers: ${all.map(describeSticker).join(', ')}]`;
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
  // The cast widens, not narrows: discord.js declares `poll` as `Poll | null`
  // (never undefined), but a partial-shaped message can omit the field
  // entirely — same reason collectionValues tolerates an absent Collection.
  const poll = message.poll as Message['poll'] | undefined;
  if (poll === null || poll === undefined) {
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
