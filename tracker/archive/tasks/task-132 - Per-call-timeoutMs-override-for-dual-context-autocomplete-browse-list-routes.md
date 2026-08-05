---
id: TASK-132
title: >-
  Per-call timeoutMs override for dual-context (autocomplete + browse) list
  routes
status: To Do
assignee: []
created_date: '2026-05-30 00:00'
updated_date: '2026-08-05 12:09'
labels:
  - 'area:clients'
  - 'area:bot-client'
  - 'size:M'
dependencies: []
priority: low
ordinal: 132000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per-call `timeoutMs` override for dual-context (autocomplete + browse) list routes

**Why:** `listPersonalities`/`listPersonas`/`listShapes` are served at `DEFERRED` (10s) because their post-defer browse callers need it, but their autocomplete callers (`autocompleteCache.ts`) share the route — so on a slow gateway the autocomplete request stays open up to 10s even though Discord expires the interaction at 3s (bot gets an unusable response; Discord.js logs "Unknown interaction" on `respond()`). Wasteful, not a correctness bug. **Fix shape**: a per-call `timeoutMs` override (call-site `AbortSignal`) so autocomplete handlers pass a short budget while browse callers use the route default — needs the typed-client method to accept an optional per-call timeout (related to the `method-builder.ts` timeout-escape-hatch item). **Promote when**: "Unknown interaction" autocomplete noise becomes observable, OR alongside the timeout-escape-hatch refactor. Surfaced 2026-05-30 by PR #1119 round-2 review. Deferred 2026-05-30.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Grounding 2026-07-30 (drain, alongside #1871): premise CONFIRMED, unlike its
sibling tasks from the same origin cluster. `listPersonalities` / `listPersonas`
(routes/user/ownership.ts) and `listShapes` (routes/user/shapes.ts) all declare
NO `timeoutMs`, so they land on the DEFERRED (10s) read default — and
`autocompleteCache.ts` calls all three (`getCachedPersonalities`/`Personas`/
`Shapes`) through the UserClient, sharing them with the browse callers.

This is the natural next same-module unit after #1871 (which landed 120/122/123/124
in `method-builder.ts` + `transport.ts`). Deliberately NOT ridden on #1871: it
changes runtime timeout behavior on a user-visible latency path and touches a
second service, so it earns its own review rather than riding a mechanical
codegen diff — same call as TASK-174 vs #1866.

Fix shape, updated for the post-#1871 code: add an optional per-call `timeoutMs`
to the generated method's options bag (`buildOptionsType` in method-builder.ts —
now also the home of `queryFieldType`), pass it through to `callGateway` so it
overrides the route default, then wire the three `autocompleteCache.ts` call
sites to pass `GATEWAY_TIMEOUTS.AUTOCOMPLETE`. Capability without that last step
would be dead scaffolding.

**Correction 2026-07-30 (b) — `listShapes` is NOT on the DEFERRED default.**
The grounding above says all three routes "declare NO `timeoutMs`, so they land
on the DEFERRED (10s) read default." True for `listPersonalities`/`listPersonas`;
FALSE for `listShapes`, which pins `GATEWAY_TIMEOUTS.EXTERNAL_PROVIDER` (40s)
explicitly so the client outwaits the handler's external shapes.inc catalog call
(`routes/user/shapes.ts:79-92`). Caught by the #1875 reviewer.

This SHARPENS the task rather than weakening it: a shapes autocomplete cache-miss
can hold a request open for **40 seconds** against Discord's 3s window, not 10 —
the widest instance of the gap, and the one a per-call override would help most.
It also means the three routes do not share one budget, so any fix must be
per-call rather than a single route-level retier.

**Correction 2026-07-30 (a) — the "ride-along" above was wrong.** A prior grounding
note claimed `AUTOCOMPLETE_TIER` "exists nowhere in the tree" and asked for the
`types.ts` docstring to be fixed. The symbol DOES exist
(`packages/clients/src/routes/manifest.test.ts:35`, added 2026-06-24 by
`5a3e6c2c2`), so the docstring was correct and no fix was needed. This was a
false negative-existence claim from an under-scoped grep — the same class as the
`VisionDescriptionWriter` miss on #1872. `00-critical.md` requires ≥3 vocabulary
variants plus an xray sweep before any "we don't have X".

**Runtime measurement 2026-07-30 (prod, ~18h window, deployment 58f9cd4f):**
ZERO occurrences of "Unknown interaction" / 10062 in 3726 lines of bot-client
logs carrying real LLM traffic. This task's own promote-when signal
("Unknown interaction autocomplete noise becomes observable") is NOT firing.
Caveat on the measurement: prod runs at info level and the autocomplete
cache-miss lines are `logger.debug`, so miss FREQUENCY is unmeasurable from
these logs — but the harm signal would be an error-level throw and it is absent.

**Counter-position now in the code, worth reading before building this:**
`manifest.test.ts:30-33` states deliberately that autocomplete-invoked routes do
NOT belong in `AUTOCOMPLETE_TIER` — "Discord bounds the autocomplete side at 3s
client-side regardless of the gateway budget, so they correctly sit on DEFERRED
(and are typically dual-called from deferred browse anyway)." That settles the
ROUTE-level tier question; it does not settle the per-CALL override this task
asks for, which is precisely the escape hatch that parenthetical leaves open.

Also note the callers are dual-context one layer up, not just the routes:
`getCachedPersonalities` is called by `randomPick.ts` (a deferred `/random`
command), so a short budget must be threaded per call site, never applied to the
cache function wholesale.

Net: mechanism real, harm unobserved, cost `size:M`. Left filed rather than
built or ruled out — a rule-out here is a user-visible-latency call, which is
the owner's per `06-backlog.md`. The stale comments that made this gap look
already-handled were fixed separately (see the read-default-flip comment sweep).

RULE-OUT EXECUTED 2026-08-05 (owner approved; council 3/3). Grounds: harm unobserved in prod (zero 'Unknown interaction'/10062 across the 2026-07-30 measurement window with real traffic); the task's own promote-when signal never fired; Discord bounds the autocomplete side at 3s client-side regardless of gateway budget (manifest.test.ts counter-position), so the cost is a wasted open request, not user-visible breakage; fix is size:M across two packages. User-visible-latency call made by the owner 2026-08-05. If 'Unknown interaction' autocomplete noise ever becomes observable, that evidence reopens the question on its own merits.
<!-- SECTION:NOTES:END -->
