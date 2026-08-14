---
id: TASK-4
title: Extract shared env-scoped-op preamble across ops commands
status: To Do
assignee: []
created_date: '2026-07-22 00:00'
updated_date: '2026-08-14 01:04'
labels:
  - 'area:tooling'
  - 'area:db'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-22 — extract the shared env-scoped-op preamble (`validateEnvironment` → banner → prod-confirm gate → `getPrismaForEnv` → try/finally) into a `beginEnvScopedOp({env, dryRun, force, confirmMessage})` helper and migrate the ~6 env-scoped tooling commands (`repair-fact-timestamps`, `backfill-ltm`, `cleanup-duplicates`, `backfill-facts`, `retention:backfill-last-active`, …) onto it. The retention backfill added a 12-line clone of this preamble (CPD baseline bumped 1750→1762 to absorb it). A **0-callback** extraction (passes the 2-callback ceiling trivially); its value is realized across all consumers, not the one new command — a focused tooling change, not a retention-PR rider. **Complements** the `confirmProductionOperation`-should-throw row below: centralizing the gate in `beginEnvScopedOp` makes the discardable-boolean class unrepresentable at the call sites. Doing both lowers the CPD baseline. **Promote when**: next tooling-DRY pass, or the next env-scoped command added.

**Why:** A standardized preamble cloned per command; the baseline absorbs it until the sweep DRYs all consumers.
<!-- SECTION:DESCRIPTION:END -->
