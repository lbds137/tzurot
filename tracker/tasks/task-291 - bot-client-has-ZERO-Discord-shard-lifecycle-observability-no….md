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
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 291000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-18 (dev autocomplete outage, ~02:33–04:25Z) — bot-client has ZERO Discord shard-lifecycle observability: no `shardDisconnect`/`shardResume`/`shardError`/`invalidated` listeners exist (grep-verified), so a silently dead/zombied gateway websocket is invisible — the process looks healthy, logs go quiet, and every interaction (incl. autocomplete) vanishes without a trace. Runtime evidence: bot booted clean 02:33Z, emitted nothing for ~2h while the owner actively retried autocomplete (gateway alive with zero requests → handler never ran); redeploy forced a fresh connection and **CURED it (owner-confirmed 2026-07-18, ~04:30Z)** — the restart-cures signature. Mechanism = suspected zombied ws (evidence-consistent incl. the cure, not directly observed — the missing listeners are exactly why it can't be observed). **Fix shape**: register shard-lifecycle listeners with structured logs (disconnect code, resume/reconnect events, `invalidated` fatal); consider a liveness watchdog (no gateway event in N min while guilds > 0 → log loud / self-heal). May also illuminate the "post-reconnect DM subscription loss" asymmetry from the DM-troubleshooting reference. **Promote when**: next bot-client boot-path touch, or a second silent-outage occurrence.

**Why:** A wedge class that presents as "user error" until someone pulls three services' logs; one listener block makes it diagnosable in one glance.

STATUS after #1982: the LISTENERS shipped (ShardLifecycleLogger — all six events, structured, PII-reduced). The task stays OPEN for the liveness watchdog.

Watchdog notes accumulated so far, for whoever builds it:
- Sequencing: it needs the shipped listeners to have run in dev first. Its whole value is catching the case where NO shard event fires, and until the events are visible we cannot tell a silent-zombie socket from an upstream problem.
- Signal: key off a single in-process lastGatewayEventAt bumped from a high-frequency client event. Events.Raw is the honest choice — MessageCreate goes legitimately quiet in a low-traffic guild and would false-alarm. Gate the check on guilds.cache.size > 0 and ws.status === Ready so an idle or reconnecting process does not trip it.
- Scheduling: 04-discord prefers a BullMQ repeatable job over setInterval, but that rule targets cross-service work. The state here is IN-PROCESS, so BullMQ would mean round-tripping a timestamp through Redis and then disambiguating which replica's socket is dead. A single setInterval registered at the composition root and cleared in the existing shutdown path (the startNotificationCacheCleanup lifecycle) satisfies the rule's actual concern — unmanaged, unbounded timers.
- OPEN QUESTION raised by the #1982 round-2 review, and the one to answer first: does anything actually notice a process that logs `invalidated` and then hangs? Check the Railway restart policy and registerProcessLifecycle. Today #1982 makes that failure LOUDER, not self-healing — if supervision already restarts on it, the watchdog's scope shrinks a lot.
- Self-healing (client.destroy + re-login) is a separate later phase: log loud first, confirm no false positives, then automate the cure.
<!-- SECTION:DESCRIPTION:END -->
