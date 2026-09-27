---
id: TASK-1138
title: >-
  Dual-platform data model: Discord and Machloket (Spacebar) feeding one Tzurot
  at once
status: To Do
assignee: []
created_date: '2026-09-27 21:08'
labels:
  - 'area:db'
  - 'area:bot-client'
  - 'size:L'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 1130000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner requirement 2026-09-27 (relayed verbatim by the Machloket client session): "Tzurot should be able to connect to both Discord and Machloket at the same time." TASK-1137 gives a per-process origin override (a second bot-client process pointed at the instance), but both processes would share api-gateway, ai-worker, Postgres and Redis. Spacebar IDs are shape-identical to Discord's (Spacebar src/util/util/Snowflake.ts:15, EPOCH 1420070400000, timestamp << 22, per the Spacebar fork session), so every table, cache key and deterministic UUID seeded from a bare Discord ID (users, channels, guilds, messages, DM routing, denylist, retention, release DMs) becomes ambiguous once two platforms feed it; collisions are unlikely but possible, and anything deriving time from an ID assumes Discord.

What: a design doc first (docs/proposals or a tracker doc), then a phased rollout. It must: enumerate every store keyed by a platform ID (schema introspection + the deterministic-UUID generators in common-types, not a sampled grep); choose the platform dimension (a platform column, or a platform-namespaced seed for the deterministic UUIDs); route outbound sends (bot-client results listener, release/retention DM workers) to the right platform's process; decide the migration path for existing rows (all Discord).

Owner question: should one person's Discord and Machloket accounts be the same Tzurot user (shared personas, memories, settings) or separate users?
Recommendation: separate users by default, keyed by (platform, platform id); cross-platform linking later as an explicit opt-in, because silent merging across platforms is a data-rights and privacy decision and separate users are the safe default that linking can build on.

Acceptance: design doc merged with the store inventory and the owner's answer recorded; rollout phases filed as tasks.
<!-- SECTION:DESCRIPTION:END -->
