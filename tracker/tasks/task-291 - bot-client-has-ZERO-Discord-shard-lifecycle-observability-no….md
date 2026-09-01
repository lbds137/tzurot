---
id: TASK-291
title: bot-client has zero Discord shard-lifecycle observability
status: To Do
assignee: []
created_date: '2026-07-18 00:00'
updated_date: '2026-09-01 01:09'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
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

SECOND OCCURRENCE 2026-09-01, prod (00:49:40Z-01:06:31Z, ~17 min). The promote-when trigger has fired. Owner reported the bot down; a redeploy CURED it again — same restart-cures signature as the July incident.

What the shipped listeners bought: this outage was NOT silent. ShardLifecycleLogger emitted ~114 structured lines/min naming the exact failure (`Shard websocket error` / `Shard reconnecting`, every one `Unexpected server response: 503`), which is why the diagnosis took minutes instead of a three-service log dig. #1982 did its job.

Runtime evidence, prod: container up 5.5h with no deploy (so not code-caused); last successful `Shard resumed` 22:01:52Z; last real activity 00:45:27Z; first `Shard websocket error` 00:49:40Z; then ~2/sec unbroken for 17 min with ZERO successful connections. No 429, no invalid-session, no disallowed-intent anywhere in the window. ai-worker was healthy throughout (jobs completing, DB pool fine), so Railway egress was not the problem. Discord's status page read All Systems Operational. The fresh container connected INSTANTLY at 01:06:31Z while the old one was still 503ing — so a healthy gateway was reachable the whole time and the fault was in the old process's connection state, not Discord-wide.

TWO FINDINGS THAT CHANGE THE WATCHDOG DESIGN ABOVE:

1. The staleness signal would NOT have fired here. The design keys off a stale `lastGatewayEventAt`, which catches the July HANG. This incident was the opposite shape - a HOT LOOP emitting shard events roughly twice a second, so `lastGatewayEventAt` stayed fresh the entire 17 minutes while the bot was 100% down. A watchdog must cover both: no events at all, AND events that never reach `ws.status === Ready`. Suggested second condition - not Ready for N minutes while `guilds.cache.size > 0`, independent of event freshness.

2. The OPEN QUESTION is answered, negatively. Nothing noticed. The process hammered the gateway for 17 minutes and no supervision restarted it - Railway's restart policy never engaged because the process never crashed or exited. So the watchdog's scope does NOT shrink; supervision provides no coverage for a non-crashing wedged process, whether it hangs or loops. Only an in-process check can see this.

Third finding, arguably its own fix: the reconnect path has no backoff and no give-up. ~2/sec forever is a Discord-side throttle/flag risk (we saw no 429 this time, which is luck rather than design) and it buried every other log line - 3,200 of the window's 3,798 lines, 84% of volume. Whoever builds the watchdog should check whether the discord.js retry config is left at defaults and whether an exponential backoff is configurable there.
<!-- SECTION:DESCRIPTION:END -->
