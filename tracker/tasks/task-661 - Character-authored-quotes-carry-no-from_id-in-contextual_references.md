---
id: TASK-661
title: Character-authored quotes carry no from_id in contextual_references
status: To Do
assignee: []
created_date: '2026-08-18 19:46'
updated_date: '2026-08-19 01:28'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 661000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found by review on PR #2143 (TASK-657 slice A), which closed this same defect class for the chat_log path. The reference path still has it.

The gap, verified: ReferencedMessageFormatter.fromLiveReference sets fromId: persona?.personaId and nothing else (services/ai-worker/src/services/ReferencedMessageFormatter.ts:410), while deriveRefRole can classify a quoted message as role="character" (services/ai-worker/src/services/prompt/referenceRole.ts:152 and :175). So a quote authored by a SIBLING AI character renders inside contextual_references with role="character" and no from_id -- the same unresolvable binding slice A fixed for chat_log lines.

Now fixable in a way it was not before: PR #2143 added character_participant entries to the participants roster, so a personality UUID finally has something to resolve against. Before that there was no roster entry to point at, which is why only the persona id was ever emitted.

Scope note: this is NOT part of TASK-660. That task is the generated blurb and card checksum; folding an unrelated binding fix into it would blur its acceptance. Deliberately filed separately.

Fix shape: give the live reference path the same two-id-space treatment formatFromIdAttribute got in conversationUtils.ts -- persona id for a user-authored quote, personality id for a character-authored one, nothing for the responder own lines. Check the STORED reference path for the same gap before closing; slice A only touched the chat_log renderer.

## SECOND HALF, from the #2144 review 2026-08-18 — same root cause, folded in rather than filed separately

The quote ROLE attribute has the same defect as the from_id, and the same fix
unblocks both. deriveRefRole / matchesSiblingPersonality / matchesSelfVariant
(services/ai-worker/src/services/prompt/referenceRole.ts) decide self-vs-sibling
for a quoted message ENTIRELY by name, because StoredReferencedMessage
(packages/common-types/src/types/schemas/message.ts) stores authorUsername,
authorDisplayName and authorDiscordId -- never a personality UUID.

So the write-time-name-staleness bug TASK-664 fixed for the chat log still
stands for quotes: a renamed personality's own pre-rename QUOTED lines
misclassify as role="character", and a same-named sibling is still swallowed as
self by the prefix match. TASK-664 could not fix it because it had no id to
compare -- that is the whole point of the fold.

ONE root cause, ONE fix: persist an authorPersonalityId on the reference,
exactly as forwardedFrom.authorPersonalityId already does for the forwarded
path. Both the from_id emission and the role decision then key on it. Filing
these as two tasks would have split one schema change across two owners.

Acceptance: a character-authored quote in contextual_references carries a from_id that resolves to a character_participant entry, AND its role attribute is decided by personality id rather than by name; a renamed personality's own quoted lines still read as role="assistant"; tests pin the user-authored and self-authored cases unchanged, and the id-less fallback keeps today's name behaviour.

## GROUNDING 2026-08-18 (read-only, while #2145 was in CI) — three things the filing does not say

1. STALE PROSE THIS TASK SHOULD FIX, created by slice A shipping.
packages/common-types/src/types/schemas/message.ts:205 still says of
forwardedFrom.authorPersonalityId: "It does not bind to a roster entry yet
either, because characters are not in `<participants>` until TASK-657 -- but it
is the value that becomes correct when they are." Slice A SHIPPED in #2143, so
characters ARE in the roster and that binding now works. The comment asserts the
opposite of the current behaviour. Same file and same field this task edits, so
fix it here rather than filing it separately.

2. NAMING DRIFT, same sweep.
services/ai-worker/src/services/prompt/ParticipantFormatter.ts:339 refers to
"TASK-657 slice B". Slice B became TASK-660 when it was split into its own unit.

Both found by grepping `TASK-657|until TASK|characters are not in` after
noticing the first one. Nothing else in the tree matched, so the sweep is
complete as of eea6191df.

3. A PRIVACY CONSTRAINT THE FIX SHAPE OMITS.
forwardedFrom is the precedent this task copies, and it is deliberately
ASYMMETRIC about access (see the docstring on forwardedOriginSchema.authorName,
message.ts:178-193): authorName resolves through the BOT's channel access, but
authorPersonalityId gates on the FORWARDER's, to keep the "Reply Loophole"
closed. The reasoning: Discord's forward feature already shows the forwarder the
message text, so a display name adds nothing they cannot read -- but a
personality id NAMES A CHARACTER THEY MAY HAVE NO ACCESS TO.

A quoted message is the same situation. So authorPersonalityId on
StoredReferencedMessage must replicate the gating, not just the field. The
current "Fix shape" says "give the live reference path the same two-id-space
treatment", which reads as a pure mechanical port and would silently drop the
access check. Do not port the field without the gate.

## DESIGN GROUNDING 2026-08-19 — the fix is NOT a mechanical port, and the size label was wrong

Read end to end before starting. Three findings that change the shape:

1. THE OBVIOUS PLACE TO RESOLVE IS CLOSED. The reference is built by
MessageFormatter.buildRawReference (services/bot-client/src/handlers/references/MessageFormatter.ts:71),
whose docstring states it is "Pure and synchronous" because that shape is what
the raw assembly envelope ships for the worker-side assembler to re-derive from.
Resolving a personality id is an async lookup. Making that function async to fit
one field puts a lookup on the AI-job-submission path and breaks a stated
contract -- do not do it without deciding that trade explicitly.

2. THE MECHANISM ALREADY EXISTS, AND IT IS CHEAP. The extended-context fetcher
resolves exactly this: options.getOurPersonalityId, wired at
services/bot-client/src/services/MessageContextBuilder.ts:185 to
redisService.getWebhookPersonality(discordMessageId) -- a Redis lookup keyed on
the Discord message id, returning the personality UUID for a message our bot
sent via webhook. It is consumed at DiscordChannelFetcher.ts:367 and lands on
ConversationMessage.personalityId (line 489), which is the value TASK-664 made
the chat log decide self-vs-sibling by. So the reference path needs the same
call, not a new resolver.

3. THE ACCESS GATE DOES NOT COME FOR FREE FROM THAT MECHANISM, and the two
candidate resolvers differ on exactly this axis:
   - getWebhookPersonality is an UNGATED id lookup. Extended context uses it
     ungated today, which is defensible there because those messages are in the
     channel the user is already reading.
   - ReplyResolutionService.resolveFromReferencedMessage
     (services/bot-client/src/services/ReplyResolutionService.ts:208) is the
     GATED one -- it ends in personalityService.loadPersonality(id, userId), the
     Reply Loophole check -- and is what the forwarded path uses.

   A REPLY is same-channel by construction, so the viewer demonstrably has
   access and the ungated lookup leaks nothing. A MESSAGE LINK can point at
   another channel, and that is precisely the Reply Loophole shape. So the
   answer is likely per-reference-kind rather than one resolver for both, and
   whichever is chosen, the reasoning belongs in a comment at the call site.

CONSEQUENCE: relabelled from size:S. This is a schema change plus a
resolution-point decision plus an access-gating decision across two services,
with the persist path (fire-and-forget backfill, as forwardedFrom does) as a
third option for where the work happens. It is a size:M at least.

The forwarded path is still the right precedent -- but it is a precedent for
BACKFILLING AFTER PERSIST (ConversationPersistence.backFillForwardedOrigin),
off the blocking path, not for resolving inline. Copying the field without
copying that placement puts a network call where the pure builder is.

## ITEM 2 OF THE GROUNDING IS CLOSED — #2150, 2026-08-19

The "TASK-657 slice B" reference in ParticipantFormatter.ts is gone: the render
half rewrote that docstring wholesale (the element now HAS an about body, so the
paragraph explaining why it did not was replaced rather than corrected). Only
the message.ts:206 stale claim remains, and it is still this task to fix —
verified by `grep -rn "TASK-657" --include=*.ts services packages`, one hit.

Also relevant to the fix shape: the roster entry a character-authored quote must
resolve to now carries a description as well as a name, so a from_id that
resolves lands the model on real prose rather than a bare name.
<!-- SECTION:DESCRIPTION:END -->
