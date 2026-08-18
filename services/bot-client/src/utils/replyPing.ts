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
 * Whether the reply-ping permits this reply to wake the character it points at.
 *
 * **Guild replies**: the ping is the user-side signal for "I am addressing
 * you", so a reply sent with it off must not wake the character.
 *
 * **DMs: always permitted, toggle ignored.** The toggle cannot carry that
 * meaning in a DM, because it is not what delivers the notification there —
 * the recipient is notified either way, and there is no room full of other
 * readers for "not you specifically" to distinguish against. Turning the ping
 * off while replying in a DM is the same gesture as replying to a human in a
 * DM with it off: still unambiguously addressed to them. Scoping the gate to
 * guilds also makes the worst failure mode unrepresentable — if Discord turns
 * out not to list a DM bot author in `mentions.users` at all, a DM-inclusive
 * gate would silence every DM reply.
 *
 * `mentions.repliedUser` is NOT the toggle signal — discord.js sets it from
 * `referenced_message.author` unconditionally, so it is populated on every
 * reply regardless. That much is settled by reading discord.js.
 *
 * NOT YET RUNTIME-VERIFIED: that `mentions.users` membership tracks the
 * toggle. It is the only field that could carry it, and discord.js's own
 * `isUserMentioned` gates reply-derived matches on exactly this membership —
 * but whether Discord omits the author when the ping is off, and whether a
 * WEBHOOK author is listed at all, are claims about Discord's wire payload
 * that only a capture can settle. `BotMentionProcessor`'s comment asserts the
 * author is included "when replying" with no mention of the toggle, which
 * would make this predicate inert in guilds; that comment is likewise
 * unverified. See TASK-649 for the capture that resolves it.
 *
 * Returns true for a NON-reply as well — callers ask this only about replies,
 * and "no toggle was set" is not a suppression signal.
 *
 * Fails OPEN when `repliedUser` is null: without the referenced author (a
 * deleted message, or an uncached partial) the toggle state is unknowable,
 * and dropping a trigger we cannot classify is worse than an extra reply.
 * Every arm is pinned in `replyPing.test.ts`.
 */
/*
 * On why this reads `mentions.users` directly instead of `MessageMentions#has`,
 * which looks like the first-class API for the job (verified against
 * discord.js 14.27.0 `MessageMentions.js`):
 *
 * - `has(user, { ignoreRepliedUser: true })` additionally requires
 *   `parsedUsers` membership (line 270), and `parsedUsers` is a regex over the
 *   message TEXT (line 232) while `users` comes straight off the API payload
 *   (lines 88-107). A reply-ping never writes the author into the text, so
 *   that option returns false for a ping-ON reply — it would suppress every
 *   reply, the worst failure this gate has.
 * - `has(user)` with defaults also returns true on `@everyone` (line 263) and
 *   on any mentioned ROLE the user holds (lines 279-283), so an unrelated
 *   `@everyone` in the message would read as "the ping is on".
 *
 * The direct membership test is the narrower and more accurate question.
 */
export function replyPingPermitsTrigger(message: Message): boolean {
  // A DM has no guild id. Checked before the toggle so no DM path can ever
  // reach the membership test.
  if (message.guildId === null || message.guildId === undefined) {
    return true;
  }

  const repliedUser = message.mentions.repliedUser;
  if (repliedUser === null || repliedUser === undefined) {
    return true;
  }
  return message.mentions.users.has(repliedUser.id);
}
