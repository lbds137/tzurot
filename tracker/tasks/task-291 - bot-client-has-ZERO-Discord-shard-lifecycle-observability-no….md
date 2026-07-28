---
id: TASK-291
title: bot-client has zero Discord shard-lifecycle observability
status: To Do
assignee: []
created_date: '2026-07-18 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'area:bot-client'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 291000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-18 (dev autocomplete outage, ~02:33–04:25Z) — bot-client has ZERO Discord shard-lifecycle observability: no `shardDisconnect`/`shardResume`/`shardError`/`invalidated` listeners exist (grep-verified), so a silently dead/zombied gateway websocket is invisible — the process looks healthy, logs go quiet, and every interaction (incl. autocomplete) vanishes without a trace. Runtime evidence: bot booted clean 02:33Z, emitted nothing for ~2h while the owner actively retried autocomplete (gateway alive with zero requests → handler never ran); redeploy forced a fresh connection and **CURED it (owner-confirmed 2026-07-18, ~04:30Z)** — the restart-cures signature. Mechanism = suspected zombied ws (evidence-consistent incl. the cure, not directly observed — the missing listeners are exactly why it can't be observed). **Fix shape**: register shard-lifecycle listeners with structured logs (disconnect code, resume/reconnect events, `invalidated` fatal); consider a liveness watchdog (no gateway event in N min while guilds > 0 → log loud / self-heal). May also illuminate the "post-reconnect DM subscription loss" asymmetry from the DM-troubleshooting reference. **Promote when**: next bot-client boot-path touch, or a second silent-outage occurrence.

**Why:** A wedge class that presents as "user error" until someone pulls three services' logs; one listener block makes it diagnosable in one glance.
<!-- SECTION:DESCRIPTION:END -->
