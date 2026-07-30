---
id: TASK-132
title: >-
  Per-call timeoutMs override for dual-context (autocomplete + browse) list
  routes
status: To Do
assignee: []
created_date: '2026-05-30 00:00'
updated_date: '2026-07-30 12:58'
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

Ride-along found while grounding: `RouteDef.timeoutMs`'s docstring
(routes/types.ts ~:287) tells the reader to "register the id in
`AUTOCOMPLETE_TIER` in manifest.test.ts" — **no such symbol exists anywhere in
the tree** (grepped packages/ + services/, the only hit is the docstring itself).
Fix the docstring in this task's PR; it is one line and this is the file.
<!-- SECTION:NOTES:END -->
