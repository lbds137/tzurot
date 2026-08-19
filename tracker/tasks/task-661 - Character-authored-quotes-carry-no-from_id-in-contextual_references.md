---
id: TASK-661
title: Character-authored quotes carry no from_id in contextual_references
status: To Do
assignee: []
created_date: '2026-08-18 19:46'
labels:
  - 'area:ai-worker'
  - 'size:S'
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
<!-- SECTION:DESCRIPTION:END -->
