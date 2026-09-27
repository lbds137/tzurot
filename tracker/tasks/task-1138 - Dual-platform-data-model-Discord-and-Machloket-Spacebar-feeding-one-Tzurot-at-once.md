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
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1130000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner requirement 2026-09-27 (relayed verbatim by the Machloket client session): "Tzurot should be able to connect to both Discord and Machloket at the same time." TASK-1137 gives a per-process origin override (a second bot-client process pointed at the instance), but both processes would share api-gateway, ai-worker, Postgres and Redis. Spacebar IDs are shape-identical to Discord's (Spacebar src/util/util/Snowflake.ts:15, EPOCH 1420070400000, timestamp << 22, per the Spacebar fork session), so every table, cache key and deterministic UUID seeded from a bare Discord ID (users, channels, guilds, messages, DM routing, denylist, retention, release DMs) becomes ambiguous once two platforms feed it; collisions are unlikely but possible, and anything deriving time from an ID assumes Discord.

What: a design doc first (docs/proposals or a tracker doc), then a phased rollout. It must: enumerate every store keyed by a platform ID (schema introspection + the deterministic-UUID generators in common-types, not a sampled grep); choose the platform dimension (a platform column, or a platform-namespaced seed for the deterministic UUIDs); route outbound sends (bot-client results listener, release/retention DM workers) to the right platform's process; decide the migration path for existing rows (all Discord).

OWNER RULING 2026-09-27 (~17:30, relayed by the Spacebar fork session, confirmed by the owner directly in the Tzurot session via AskUserQuestion): ONE Tzurot user per person — Discord and Machloket accounts share personas, memories and settings — reached through an EXPLICIT link flow: accounts stay separate until linked, linking requires proof from both sides (e.g. a link command on one platform confirmed on the other), and the design includes a merge path for data written before the link. Auto-linking was offered and not chosen. The link/proof flow and the pre-link merge semantics are the driver's design calls (engineering), except any user-visible merge conflict policy, which goes back to the owner.

Acceptance: design doc merged with the store inventory, the (platform, platform id) identity model, the link/proof flow and the pre-link merge path; rollout phases filed as tasks.
<!-- SECTION:DESCRIPTION:END -->
