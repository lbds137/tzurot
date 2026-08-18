---
id: TASK-649
title: >-
  Reply to a character webhook fires the character even when the reply-ping is
  disabled
status: To Do
assignee: []
created_date: '2026-08-18 00:18'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 649000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner intake 2026-08-17 (prod, #admin). Replying to a character webhook message with Discord's reply-ping toggled OFF still triggers the character. The ping toggle is the user-side signal for "I am not addressing you"; honoring it is the expected behavior.

Verified halves: (1) the inbound ping signal is never consulted -- every repliedUser/allowedMentions occurrence in services/ and packages/ is OUTBOUND send config (VoiceTranscriptionService.ts:177,432; PersonalityTriggerProcessor.ts:258); the reply trigger at PersonalityTriggerProcessor.ts:164-177 gates only on message.reference. (2) mentions.repliedUser is NOT the ping signal -- discord.js 14.27.0 Message.js:279 passes data.referenced_message.author unconditionally, so it is populated on every reply. The ping signal is membership in mentions.users (MessageMentions.js:267 relies on exactly that conjunction).

Fix shape: gate resolveReplyPersonality on the replied-to author appearing in message.mentions.users; fail OPEN when repliedUser is null (deleted/partial referenced message) since the toggle state is then unknowable.

OPEN QUESTION requiring a runtime capture, NOT code-reading: whether Discord includes a WEBHOOK author in the mentions array when the reply-ping is ON. If it does not, this gate suppresses every reply and is a severe regression. Confirm in dev (reply ping-on vs ping-off, observe mentions.users) BEFORE this reaches prod.

The open question has TWO failure directions, not one (the second surfaced from PR #2133 review item 3). If Discord omits a webhook author from mentions even when the ping is ON, the gate suppresses every reply. If Discord includes the replied author regardless of the toggle, the gate is inert and the bug is unfixed. BotMentionProcessor.ts:24-26 carries a comment asserting the latter ("Discord auto-includes author in mentions when replying", no mention of the toggle) and works around it with a content regex -- that comment is itself unverified and predates any toggle testing, so it is a hypothesis to check, not a conclusion.

Dev capture plan (the deployed debug log emits mentionedUserIds on the suppressed path; the existing "Multi-tag trigger resolved" line emits sources): (1) guild reply to a character webhook, ping ON; (2) same, ping OFF; (3) DM reply to the bot, ping ON; (4) same, ping OFF. Case 3/4 matter because the DM path is a real bot user rather than a webhook pseudo-user and may not share the webhook semantics. Also note whether the reporting channel was activated -- an activated channel answers via the activation trigger regardless, which the sources field distinguishes.

Acceptance: reply with ping ON triggers the character; reply with ping OFF does not; DM replies follow the same rule; both directions confirmed by the dev capture rather than by reading the code.
## DESIGN CHANGED 2026-08-18 (owner call) — the gate is GUILD-ONLY

Owner: "I feel like reply ping shouldn't matter in DMs - I'd expect DMs to
always fire regardless of ping status. it should only matter inside a guild
imho (I'm thinking of semantics of how one would interact with a human user -
DMs always ping regardless, right?)"

Accepted, and it is the stronger model. The toggle cannot mean "I am not
addressing you" in a DM: it is not what delivers the notification there, and
there is no room of other readers for "not you specifically" to distinguish
against. Replying ping-off in a DM is the same gesture as doing so to a human
in a DM — still unambiguously addressed to them.

It also makes the WORST failure direction unrepresentable rather than merely
tested. The dangerous branch was "Discord may not list a webhook/bot author in
mentions.users even when the ping is ON", which would have silenced every
reply. Not gating in DMs at all removes that for the DM half outright.

Implemented: replyPingIsEnabled renamed to replyPingPermitsTrigger, with a
guildId null/undefined check running BEFORE the membership test so no DM path
can reach it. Pinned by four DM tests including one asserting the mentions
fields are never read at all in a DM; removing the carve-out turns three red.

## REVISED capture plan — cases 1 and 2 are the gate test

(1) guild reply to a character webhook, ping ON  -> character responds
(2) guild reply, ping OFF                        -> character stays silent
(3) DM reply to the bot, ping ON                 -> responds
(4) DM reply, ping OFF                           -> responds (NOT silent)

Cases 3 and 4 changed meaning: they are no longer gate tests but REGRESSION
checks that DMs were not affected. Case 4 flipping to silent would mean the
guild check is not working.

The remaining open question is now guild-only: whether Discord lists a WEBHOOK
author in mentions.users when the ping is ON. If it does not, case 1 fails and
the guild gate is a regression — still a real risk, but half the blast radius
of the original design.

Also still note whether the test channel is ACTIVATED — an activated channel
answers via the activation trigger regardless, which the sources field on
"Multi-tag trigger resolved" distinguishes.

## Finalize checklist (after the capture is read)

1. Decide the gate against the observed `repliedUserIsMentioned` values, not
   against the code reading. Absence of any capture line is a finding too, not
   a retry signal.
2. **Trim the NOT-YET-RUNTIME-VERIFIED block in replyPing.ts.** Once the
   mechanism is confirmed it becomes permanent stale hedging, which
   02-code-standards § "A Comment That Asserts Behavior Is a Claim" is against
   — the comment should then state the verified behavior and name the capture.
   Raised by review on #2133 and accepted.
3. Remove the #2139 instrumentation in its cleanup commit (`debug` type both
   ways, per 05-tooling), and confirm with
   `git log --grep '^debug[:(]' origin/develop..HEAD`.
4. The capture must be confirmed before this reaches a RELEASE, not merely
   before the develop merge — develop auto-deploys, so a merged-but-unverified
   gate could ride a release cut if the PR sits.

## CAPTURE READ 2026-08-18 — round 1, and the OVERCLAIM it produced

Owner ran two guild replies to a character webhook on dev (container
94dfda596415), one ping ON and one ping OFF. Both lines:

    repliedUserId="1472768398135001108" mentionedUserIds=[] repliedUserIsMentioned=false

`mentions.users` empty in BOTH. `repliedUserId` is not the bot client id, so the
replied author is a character webhook — the case the trigger path serves.

**What this proves:** `mentions.users.has(repliedUser.id)` returns false for
every guild reply to a character, so the #2133 predicate as written would have
SILENCED EVERY REPLY. That is decisive and it is why the predicate's input must
change.

**What I wrongly claimed it proved:** that no signal exists anywhere in
Discord's payload. That is a negative existence claim built on a ONE-FIELD
probe — the single field the gate happened to use — with NO POSITIVE CONTROL.
An empty `mentions` is indistinguishable from a broken instrument. I closed
#2133 on it; owner pushed back, correctly, and it is reopened.

Failure shape for the corpus: a negative probe result is not a finding until
the same instrument returns a POSITIVE on a known-present case. The
positive-control requirement already exists in 00-critical (Grep Rule) but is
written for greps; nothing attached it to runtime probes.

## Round 2 — the exhaustive field inventory (read from the type defs)

Every field on Discord`s message object that could carry mention/notification
state, from discord-api-types 0.38.53 payloads/v10/message.d.ts
(APIBaseMessageNoChannel + APIMessageMentions), NOT from a guess:

    mentions          APIUser[]            the replied_user mechanism`s target
    mention_everyone  boolean
    mention_roles     role id[]
    mention_channels  APIChannelMention[]
    flags             MessageFlags

MessageFlags carries no reply-ping bit. The only notification-adjacent bit is
SuppressNotifications = 4096 (Discord`s @silent). So on the type surface the
ONLY field that can carry reply-ping state is `mentions` — which is what makes
the positive control the whole question rather than a formality.

## CANDIDATE ALTERNATIVE SIGNAL: the @silent flag (4096)

Not the reply-ping toggle, but observable, native, and semantically adjacent:
a user sending "@silent" gets MessageFlags.SuppressNotifications set, and
discord.js parses `flags` (Message.js:345). "Reply with @silent -> do not wake
the character" is implementable TODAY if the capture confirms the bit arrives.

Added to the capture plan rather than assumed. Owner`s call on whether the
gesture is acceptable UX; the technical question is only whether the bit lands.

## Round 2 capture plan (PR #2140) — positive control is the point

    1  reply to character webhook, ping ON      the target case
    2  reply to character webhook, ping OFF     the target case
    3  reply to a REAL USER, ping ON            POSITIVE CONTROL
    4  reply to a REAL USER, ping OFF           POSITIVE CONTROL
    5  reply to character webhook, @silent      candidate-signal test
    6  reply to character webhook, normal       candidate-signal baseline

If 3 and 4 differ, the mechanism is alive and webhooks are a genuine exception.
If 3 and 4 are IDENTICAL, the instrument or my reading of it is wrong and the
round-1 webhook result meant nothing.

#2140 logs the raw REST payload`s full top-level key set rather than a chosen
subset, so a discriminating field can surface even if nobody predicted it.

resolveReplyPersonality runs for every non-forwarded reply, so all six cases
reach the log line whether or not a character resolves.

## SETTLED 2026-08-18 (read-only, no deploy) — reply-ping is UNOBSERVABLE for webhooks

Round 2 never needed a deploy. Everything below came from read-only REST calls
against the live API, in the three steps the round-1 claim was missing.

**1. Declared field inventory** (discord-api-types 0.38.53,
payloads/v10/message.d.ts): the only fields carrying mention/notification state
are mentions, mention_everyone, mention_roles, mention_channels, flags.
MessageFlags has no reply-ping bit; the only notification-adjacent one is
SuppressNotifications = 4096. So `mentions` is the sole candidate, established
from the declaration rather than from a guess.

**2. Raw refetch of BOTH round-1 replies** (1539230684525236284,
1539230821825908747 in #rotzot 1377516899461627945). Identical in every field,
not merely in mentions.users: mentions [], mention_roles [], mention_everyone
false, flags 0, type 19, and the same top-level key set. Both reference
webhook 1472768398135001108 (referenced_message.webhook_id equals the author
id, so the referenced author is confirmed a webhook, not the bot user).

**3. POSITIVE CONTROL over the real corpus** — 435 messages across six
channels, counting how often a reply`s referenced author appears in its own
mentions array:

    referenced author = real user     61 present / 82 absent   (143 total)
    referenced author = webhook        0 present / 52 absent   ( 52 total)

The user row is what round 1 lacked, and it passes decisively: the reply-ping
mechanism is alive and plainly observable, 61 of 143. Only against that does
the webhook row mean anything — and it is 0 of 52, never once.

**Conclusion (now earned rather than guessed):** Discord does not list a
webhook author in `mentions` under any circumstances. Characters post via
webhooks, so the reply-ping toggle is unobservable for exactly the messages
the #2133 gate must classify. Round 1 reached this conclusion by luck; a
correct answer from a one-field probe is still a guess.

## Remaining options for #2133 (OWNER decision — per-message control is the crux)

A. **@silent flag (MessageFlags.SuppressNotifications, 4096).** Native,
   per-message, semantically exact ("do not notify"). discord.js parses flags
   (Message.js:345). NOT YET VERIFIED that the bit arrives: 0 of 435 scanned
   messages had it set, so the corpus proves only that nobody uses it. One
   owner message settles it read-only, no deploy — send an @silent reply in
   #rotzot and the flag is refetchable immediately. Cheapest decisive step.

B. **Config-cascade switch disabling reply-triggering** per channel/user/
   personality. Implementable today with no new signal; a new enum field on
   configOverrides needs no migration. Blunt: all-or-nothing, loses the
   per-message granularity the owner actually asked for.

C. **Text-prefix convention** (leading marker on the reply). Per-message and
   unambiguous, but invents UX Discord does not suggest.

D. **Status quo** — any reply wakes the character.

Recommendation: verify A first, because it is the only native option with the
granularity the request implies, and verifying costs one message. B is the
fallback if the @silent gesture reads as too obscure for the userbase.

## Still owed after the capture

1. Owner picks among A-D above; #2133 stays OPEN until then.
2. If A: one @silent reply in #rotzot, then a read-only refetch confirms the
   bit. No deploy needed either way.
3. Instrumentation removal is PR #2140 (the `debug` pair`s second half).
4. Whatever gate lands, confirm before a RELEASE, not merely before the
   develop merge -- develop auto-deploys.

<!-- SECTION:DESCRIPTION:END -->
