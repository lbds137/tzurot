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
<!-- SECTION:DESCRIPTION:END -->
