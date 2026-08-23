---
id: TASK-43
title: Resolve user-mentions in forwarded snapshots (rawMentionedUsers)
status: To Do
assignee: []
created_date: '2026-06-29 00:00'
updated_date: '2026-07-28 10:47'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Forwarded snapshot `<@id>` user-mentions unresolved (`rawMentionedUsers` ← `message.mentions.users`)

**Why:** `RawEnvelopeBuilder.buildRawAssemblyInputs` sources `rawMentionedUsers` from `message.mentions.users` — the forward WRAPPER's parsed mentions (empty), not the snapshot's. A `<@id>` inside forwarded snapshot text therefore has no target in the worker's `contentRewriter` lookup → it stays raw/unresolved (persona name not substituted). Lower severity than the content-loss bug fixed in #1391 (the forward TEXT now reaches the AI via `rawMessageContent`; only embedded user-mentions degrade) and **non-trivial**: `MessageSnapshot` strips mention metadata (no `snapshot.mentions`), so the fix needs regex-extracting `<@id>` from the snapshot text + ID-only resolution (worker `getOrCreateUser` by discordId without a username). Channel/role mentions are NOT affected (the `MentionResolver` scans the passed snapshot content — audit-confirmed). **Fix shape**: parse `<@id>` from `getEffectiveContent(message)` in the producer, ship id-only `rawMentionedUsers` for forwards; worker resolves persona by id. **Promote when**: the envelope-hardening PR, or when a user reports unresolved mentions inside a forward. Surfaced 2026-06-29 (envelope regression audit + PR #1391 review).
PREMISE CHALLENGED 2026-08-20, against the shipped discord.js 14.27.0 typings. The task calls the fix non-trivial on the grounds that MessageSnapshot strips mention metadata (no snapshot.mentions), so it needs regex extraction plus id-only resolution. That premise is FALSE at the type level.

MessageSnapshot is declared as Partialize<Message, null, Exclude<keyof Message, 'attachments'|'client'|'components'|'content'|'createdTimestamp'|'editedTimestamp'|'embeds'|'flags'|'mentions'|'stickers'|'type'>>. Reading Partialize's own signature (PartialType, NulledKeys, NullableKeys, OverridableKeys), that third argument is NullableKeys — so every key NOT in that list becomes T[K] | null, and every key IN it keeps its full non-nullable type. 'mentions' is in the keep list. So snapshot.mentions is typed as a full MessageMentions, not stripped.

WHAT THIS DOES AND DOES NOT ESTABLISH. It establishes that the stated blocker is wrong as written. It does NOT establish that Discord actually POPULATES mentions in the snapshot payload — a declaration is not a producer, and this corpus has been bitten by that exact substitution before. Do not jump to the conclusion that the fix is a one-liner.

NEXT STEP IS A PROBE, NOT AN IMPLEMENTATION. Before designing anything, capture one forward whose snapshot text contains an at-mention and log snapshot.mentions.users.size. Cheap: the owner already exercises forwards during smoke rounds, so this can ride an existing dev session or a one-commit debug instrumentation (the debug commit type exists for exactly this). If populated, the fix collapses to reading snapshot.mentions.users and usernames come along for free, which removes the id-only-resolution half entirely and likely makes this size:S. If genuinely empty at runtime, the filed regex-plus-fetch shape stands and now rests on evidence instead of an assumption.

PROSE SWEEP OWED. RawEnvelopeBuilder.ts carries the same false claim in the eslint-disable justification at the wrapperMentionedUsers site (it says MessageSnapshot strips mention metadata, so it needs regex plus a per-id fetch). Whichever PR resolves this task corrects that comment in the same change; it is currently a wrong premise sitting in a suppression justification, which is where it is least likely to be questioned.
TYPE-LEVEL PREMISE CHECK RE-VERIFIED FIRST-HAND against the shipped typings at
node_modules/.pnpm/discord.js@14.27.0/node_modules/discord.js/typings/index.d.ts:7388-7405 (the
MessageSnapshot declaration) and :7667-7680 (Partialize itself). Confirms the challenge above: the
third Partialize argument is NullableKeys, and 'mentions' sits in the Exclude keep-list, so it never
reaches the nullable branch. snapshot.mentions is a full MessageMentions. The filed blocker is wrong
as written. This still does NOT establish that Discord populates it on the wire.

PROBE IS DRAFTED AND RIDES THE beta.206 SMOKES AT NO OWNER COST. One debug-type commit at
RawEnvelopeBuilder.ts:151-158, gated on isForwardedMessage, logging BOTH sizes in one line:
message.mentions.users.size (the wrapper, which the comment claims is 0 for forwards, itself
unverified) and getFirstSnapshot(message)?.mentions?.users?.size. IDs only, never usernames.

SEQUENCING CONSTRAINT: the debug commit must land BEFORE the beta.206 smoke kickoff or the
ride-along is lost and the probe needs its own owner session. The smoke instruction must also
require an at-mention IN THE FORWARDED TEXT: a forward without one yields no result, not a
negative result.

<!-- SECTION:DESCRIPTION:END -->

## Probe result (runtime observation, dev 2026-08-23 02:51 UTC)

The #2171 probe fired on a triggering forward whose snapshot text contained one mention (messageId 1540916236685156474):
`wrapperMentionCount=0 snapshotPresent=true snapshotMentionsPresent=true snapshotMentionCount=1 snapshotContentHasMentionToken=true`

Answer: Discord POPULATES `snapshot.mentions` on forward payloads, and the wrapper message carries none — the snapshot is the only source. **Fix shape settled: resolve `<@id>` tokens in forwarded text against `snapshot.mentions.users` directly** (no regex-extract-and-resolve fallback needed). The fix PR also removes the probe (paired `debug` commit per its own docstring).
