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

2. The OPEN QUESTION is answered, negatively. Nothing noticed: the process hammered the gateway for 17 minutes and nothing restarted it. That is the OBSERVATION. Note what it does NOT establish - the process never crashed or exited, so this window says nothing about what Railway would do with one that did (see VERIFY FIRST below, and do not read this paragraph as having settled it). What it does establish is enough: nothing today covers a non-crashing wedged process, whether it hangs or loops, so the watchdog's scope does NOT shrink. Only an in-process check can see this state at all.

Third finding, arguably its own fix: the reconnect path has no backoff and no give-up. ~2/sec forever is a Discord-side throttle/flag risk (we saw no 429 this time, which is luck rather than design) and it buried every other log line - 3,200 of the window's 3,798 lines, 84% of volume. Whoever builds the watchdog should check whether the discord.js retry config is left at defaults and whether an exponential backoff is configurable there.

GROUNDING PASS 2026-09-01, read-only, for whoever builds this. All cites verified against the tree at that date; re-verify before editing, cites drift.

- Client construction, `services/bot-client/src/index.ts:145-158`: only `intents`, `partials`, `allowedMentions` are set. `rest` retry options, `ws` options, `shardCount` are ALL absent, so every reconnect and backoff behaviour is the discord.js default. That confirms the third finding above has a concrete home - there is a config surface we have simply never touched. What the defaults actually DO is an external-system claim and is NOT established; probe before designing against it.
- `ShardLifecycleLogger.ts`: registers all six shard events and does logging ONLY - no metrics, no notification, no self-heal, no exit. Registered at `index.ts:643`.
- `bootWatchdog.ts:38-77`: a 5-minute BOOT deadline that calls `exit(1)` if boot never completes. Two things follow. It is precedent in our own codebase for the exit-and-let-supervision-restart shape, so a runtime watchdog would not be introducing a new pattern. And its scope is boot only - it is disarmed at `index.ts:968`, so it cannot see a post-boot wedge.
- `gatewayServiceCalls.ts:642-653` `healthCheck()` is a ONE-SHOT boot probe against the api-gateway's `/health` (called once at `index.ts:916`). It does not test the Discord connection and never runs again. bot-client exposes no HTTP liveness endpoint of its own.
- `registerProcessLifecycle` (`packages/common-types/src/utils/processLifecycle.ts:75-164`), configured at `index.ts:735-746` with `rejectionPolicy: 'log-and-live'`. Handles SIGTERM/SIGINT/uncaughtException. NOTHING exits the process on a Discord failure after boot.
- No Railway healthcheck or restart policy exists in-repo: no HEALTHCHECK in `services/bot-client/Dockerfile`, no railway.json/toml, no nixpacks config.

THE CONSTRAINT THAT SHAPES THE WHOLE DESIGN: the existing owner-alert mechanism is `postOwnerChannelEmbed` (`services/bot-client/src/utils/ownerChannel.ts:26-51`), used by ReleaseFlagNagScheduler, SecretRotationNagScheduler and ErrorChannelReporter. It posts an embed to FEEDBACK_CHANNEL_ID THROUGH THE DISCORD CLIENT, and is best-effort - it never throws and logs a warning on failure. So it structurally cannot deliver a gateway-down alert: the transport is the thing that is broken. Any "tell the owner the bot is down" path must be out-of-band (or must be self-heal instead of alert, which sidesteps the transport problem entirely). This is why the owner currently finds out by looking at Discord.

VERIFY FIRST, before any design commits to it: does Railway actually restart a container that exits non-zero? The exit-and-restart strategy - which bootWatchdog already assumes - rests entirely on it, and no restart policy is declared in-repo, so this is Railway platform default behaviour we have never probed. If it does NOT restart, self-heal has to be in-process (client.destroy + re-login) and the whole design changes.

PROBE ATTEMPTED 2026-09-01, INCONCLUSIVE - do not repeat it. Counted `Starting Container` lines in the current deployment of all three services: bot-client 1, ai-worker 1, api-gateway 1. More than one would have proven an automatic in-deployment restart. One does not disprove it, because none of those three processes crashed during its window - so this is a null result, not a negative one. Also checked `railway --help`: the CLI exposes no restart-policy or service-settings surface (only add/domain/service/ssh/redeploy), so the setting is not readable this way.

What would actually settle it, in rough order of cost: read the service settings in the Railway dashboard; query the Railway GraphQL API for the service's restart policy; or find a HISTORICAL deployment whose logs contain both a crash/exit and a subsequent `Starting Container` (needs the deployment-ID log form, `railway logs <DEPLOYMENT_ID>`, since plain `railway logs` only reads the current deployment). Deliberately crashing a prod service to find out is NOT sanctioned - it needs owner approval and a dev target at minimum.

VERIFY-FIRST QUESTION ANSWERED 2026-08-31, definitively. Railway DOES restart a container that exits non-zero. Read from the Railway GraphQL API (backboard.railway.com/graphql/v2, serviceInstance query, auth from the CLI token in ~/.railway/config.json) - the second of the three settlement paths this task listed, and it works, so the INCONCLUSIVE log-counting probe above never needs repeating.

  restartPolicyType: ON_FAILURE
  restartPolicyMaxRetries: 10
  healthcheckPath: null
  healthcheckTimeout: null
  numReplicas: null
  sleepApplication: false

Uniform across bot-client, ai-worker and api-gateway, and identical in development and production - so dev is a faithful test bed for any exit-based self-heal.

What this settles:
- The exit-and-let-supervision-restart shape is SOUND. bootWatchdog was not resting on an unverified assumption after all; ON_FAILURE is exactly what it needs.
- healthcheckPath: null independently confirms the in-repo finding (no HEALTHCHECK in the Dockerfile, no railway.json). Railway is not probing liveness, so nothing external can ever notice a wedged-but-running process. Only an in-process check can.
- A watchdog can therefore be: detect wedge, log loud, process.exit(1), let Railway restart. No in-process client.destroy plus re-login is required, though it remains an option.

NEW CONSTRAINT THIS INTRODUCES, and it must shape the design: maxRetries is 10. A watchdog that exits immediately on every wedge can burn all ten retries against a persistent upstream fault - and the 2026-09-01 incident was a 17-minute unbroken 503 wall, which is exactly the shape that would do it. Ten fast restarts would leave the service stopped with nothing left to restart it, which is strictly WORSE than todays hang. So an exit-based self-heal needs a backoff or a minimum-uptime gate before it is allowed to exit again, not a bare exit on first detection.

NOT ESTABLISHED, and worth checking before building: whether the retry counter resets (per deployment, after a sustained healthy period, or never). That determines whether the ten are a lifetime budget or a per-incident one. The GraphQL surface above does not expose it; it is Railway platform behaviour and needs its own probe or doc read.

ALERTING PROBE 2026-08-31 - the out-of-band transport ALREADY EXISTS and is already wired. Railway has a first-class notification system (GraphQL: notificationRules query, notificationRuleCreate mutation; delivery types EMAIL, INAPP, WEBHOOK). Two rules are already configured on this workspace, both scoped to the tzurot project, and both subscribe to the FULL deployment event set - including Deployment.crashed and Deployment.restarted. Both deliver to Discord webhooks. (URLs deliberately not recorded here: a Discord webhook URL is a capability-shaped secret. Read them from the Railway dashboard or the notificationRules query if needed.)

WHY THIS SOLVES THE TRANSPORT PROBLEM the constraint section above describes. postOwnerChannelEmbed cannot deliver a gateway-down alert because it posts THROUGH the bot Discord client - the broken thing is the transport. A Railway notification is a different transport entirely: Railway servers POST to the Discord REST webhook endpoint, with no involvement from our process or its gateway socket. During the 2026-09-01 incident a healthy Discord was reachable the whole time (the fresh container connected instantly), so this path would have worked.

THE REASON NO ALERT FIRED ON 2026-09-01 IS NOT A MISSING CHANNEL - IT IS A MISSING EVENT. The rules were live and correct; the process simply never crashed, so Railway emitted no deployment event to notify on. It hammered the gateway for 17 minutes in a state Railway considers perfectly healthy.

CONSEQUENCE FOR THE DESIGN, and it is a large simplification: making the watchdog exit non-zero buys the alerting for FREE, with zero new infrastructure. The exit produces a Deployment.crashed (and the ON_FAILURE restart produces Deployment.restarted), both of which already have a delivery path the owner already watches. Self-heal and notify stop being two features and become one - which is the owner decision recorded 2026-08-31: self-heal via watchdog exit with a minimum-uptime gate, reusing Railway alerting rather than building a transport.

STILL UNVERIFIED, do not state as fact: that a process exit inside a running container is classified Deployment.crashed rather than being silently restarted with no event. ON_FAILURE plus maxRetries 10 is read from the API; the EVENT emitted on an in-container exit is a separate Railway behaviour and was not probed. Cheapest falsification: exit(1) a dev service on purpose and watch whether a webhook fires. Dev restart policy is identical to prod, so dev is a faithful test bed.

CRASH PROBE 2026-09-01 ~03:04Z, dev bot-client, owner-authorized ("it's fine to purposely crash the dev bot"). Reproduced the watchdog's exact action - process.exit(1) inside the running container - via railway ssh: SIGKILL on pid 1 is ignored from inside the PID namespace (as expected; node IS pid 1), so the working path was kill -USR1 1 to open the localhost-only inspector, then piping exec("process.exit(1)") into node inspect. Results, all read back from the Railway API:

- Railway restarted the process IN-PLACE: fresh container booted ~2s later (new hostname, full boot sequence, shard ready). Exit-and-let-Railway-restart is now RUNTIME-confirmed, not just policy-read.
- The STILL-UNVERIFIED caution above was right: there is NO Deployment.crashed for an in-container exit. The deployment status never transitioned (still SUCCESS, statusUpdatedAt unchanged from the deploy).
- What Railway DOES emit: action "restarted" in the project event stream (GraphQL events query), timestamped to the exit and naming the bot-client serviceId. The configured notification rules subscribe to Deployment.restarted as well as Deployment.crashed, so the alert path rides the RESTARTED event, not the crashed one.
- Discord webhook delivery for that restarted event: ANSWERED 2026-09-01, negatively. A test ping sent directly through both configured webhooks arrived (owner-confirmed with a screenshot), proving the webhook-to-channel half works - but no Railway message for the 03:04 restart exists in the channel (owner searched in:channel bot-client; latest bot-client entries are the earlier deploy events). So Railway emits the restarted event internally but does NOT deliver a notification for an in-place restart, despite the rule subscribing to Deployment.restarted.

Design consequence, REVISED (supersedes the paragraph above this probe): the "alerting comes free" conclusion is dead - a watchdog exit self-heals silently at the Railway layer. The owner also flagged that the webhook target channel (#bot-updates) is a Railway spam firehose they never watch, so even delivered events would not function as alerts. Owner decision 2026-09-01: the watchdog itself sends the alert - an env-gated Discord webhook POST (WATCHDOG_ALERT_WEBHOOK_URL) before exit(1), best-effort with a short timeout, pointed at the owner's own log channel (webhook reuse is fine - a webhook is channel-scoped and shareable). A webhook POST is plain HTTPS REST and never touches the wedged gateway socket, so it has the same transport-independence the Railway path was chosen for. What exhausting maxRetries (10) escalates to remains unprobed.
<!-- SECTION:DESCRIPTION:END -->
