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

## CAPTURE READ 2026-08-18 — the gate is NOT IMPLEMENTABLE. #2133 closed.

Owner ran cases 1 and 2 on dev (container 94dfda596415). Both lines, verbatim
from `ops logs --env dev --service bot-client --filter REPLY-PING`:

    messageId="1539230684525236284" guildId="616105024367624212"
    repliedUserId="1472768398135001108" mentionedUserIds=[] repliedUserIsMentioned=false

    messageId="1539230821825908747" guildId="616105024367624212"
    repliedUserId="1472768398135001108" mentionedUserIds=[] repliedUserIsMentioned=false

Two distinct messages, 31s apart, one ping ON and one ping OFF per the owner.
`mentions.users` is EMPTY in BOTH. `repliedUserId` is not the bot client id, so
the replied author is a character webhook — the case the trigger path serves.

This is the dangerous branch this task named: the ping-ON reply is
indistinguishable from the ping-OFF one, so `mentions.users.has(repliedUser.id)`
returns false for EVERY guild reply. Merging #2133 would have silenced every
reply to every character in every guild. The gate is inert-and-harmful, not
merely inert.

Leading hypothesis for the mechanism (NOT separately verified): Discord does not
list a webhook author in the `mentions` array at all, because a webhook is not a
user there is anything to notify. That would also explain why
BotMentionProcessor.ts:24-26's "auto-includes author in mentions when replying"
holds for the BOT USER path it was written about while failing here — that
comment is still unverified for its own path and is not relied on by this
finding.

Single assumption in the reading: that the first reply genuinely had the toggle
ON. Owner stated it. If Discord greys the toggle out for webhook messages, the
practical conclusion is unchanged — no distinguishable state reaches the bot.

Verdict: no inbound signal carries reply-ping state for replies to webhooks, so
the feature as specified cannot be built. Status quo stands: any reply to a
character wakes it. Reopening requires a NEW signal, not a new gate.

Remaining owner decision (surfaced, not decided here): whether to want a blunter
substitute — e.g. a config-cascade switch that disables reply-triggering
entirely per channel/user — or to accept the status quo.

<!-- SECTION:DESCRIPTION:END -->
