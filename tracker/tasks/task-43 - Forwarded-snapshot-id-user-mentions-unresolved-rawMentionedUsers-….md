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
<!-- SECTION:DESCRIPTION:END -->
