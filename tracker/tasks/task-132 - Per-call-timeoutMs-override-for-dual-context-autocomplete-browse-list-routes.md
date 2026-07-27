---
id: TASK-132
title: 'Per-call timeoutMs override for dual-context (autocomplete + browse) list routes'
status: To Do
assignee: []
created_date: '2026-05-30 00:00'
labels: []
dependencies: []
ordinal: 132000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Per-call `timeoutMs` override for dual-context (autocomplete + browse) list routes

**Why:** `listPersonalities`/`listPersonas`/`listShapes` are served at `DEFERRED` (10s) because their post-defer browse callers need it, but their autocomplete callers (`autocompleteCache.ts`) share the route — so on a slow gateway the autocomplete request stays open up to 10s even though Discord expires the interaction at 3s (bot gets an unusable response; Discord.js logs "Unknown interaction" on `respond()`). Wasteful, not a correctness bug. **Fix shape**: a per-call `timeoutMs` override (call-site `AbortSignal`) so autocomplete handlers pass a short budget while browse callers use the route default — needs the typed-client method to accept an optional per-call timeout (related to the `method-builder.ts` timeout-escape-hatch item). **Promote when**: "Unknown interaction" autocomplete noise becomes observable, OR alongside the timeout-escape-hatch refactor. Surfaced 2026-05-30 by PR #1119 round-2 review. Deferred 2026-05-30.
<!-- SECTION:DESCRIPTION:END -->
