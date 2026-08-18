/**
 * Discord's reply-ping ("@ ON/OFF") toggle, read off an inbound message.
 *
 * Shared rather than local to one processor: both the reply TRIGGER
 * (`PersonalityTriggerProcessor`) and the voice path's
 * `continueToPersonalityHandler` observability field classify the same input,
 * and a second copy of this predicate would drift into reporting a different
 * answer than the one that actually routed the message.
 */

import type { Message } from 'discord.js';

/**
 * Whether the user left the reply-ping enabled on a reply.
 *
 * The ping is the user-side signal for "I am addressing you", so a reply sent
 * with it off must not wake the character it points at.
 *
 * `mentions.repliedUser` is NOT that signal — discord.js sets it from
 * `referenced_message.author` unconditionally, so it is populated on every
 * reply regardless of the toggle. That much is settled by reading discord.js.
 *
 * NOT YET RUNTIME-VERIFIED: that `mentions.users` membership tracks the
 * toggle. It is the only field that could carry it, and discord.js's own
 * `isUserMentioned` gates reply-derived matches on exactly this membership —
 * but whether Discord omits the author when the ping is off, and whether a
 * WEBHOOK author is listed at all, are claims about Discord's wire payload
 * that only a capture can settle. `BotMentionProcessor`'s comment asserts the
 * author is included "when replying" with no mention of the toggle, which
 * would make this predicate inert; that comment is likewise unverified. See
 * TASK-649 for the capture that resolves it.
 *
 * Returns true for a NON-reply as well — callers ask this only about replies,
 * and "no toggle was set" is not a suppression signal.
 *
 * Fails OPEN when `repliedUser` is null: without the referenced author (a
 * deleted message, or an uncached partial) the toggle state is unknowable,
 * and dropping a trigger we cannot classify is worse than an extra reply.
 * Both arms are pinned in `replyPing.test.ts`.
 */
export function replyPingIsEnabled(message: Message): boolean {
  const repliedUser = message.mentions.repliedUser;
  if (repliedUser === null || repliedUser === undefined) {
    return true;
  }
  return message.mentions.users.has(repliedUser.id);
}
