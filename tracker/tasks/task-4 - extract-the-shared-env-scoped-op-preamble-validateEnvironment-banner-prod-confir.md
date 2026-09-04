---
id: TASK-4
title: Extract shared env-scoped-op preamble across ops commands
status: To Do
assignee: []
created_date: '2026-07-22 00:00'
updated_date: '2026-09-04 19:37'
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

**Members added 2026-08-16 (PR #2120 review, claude-review round 2):** (a) `requireProductionConfirmation`'s banner hardcodes "on PRODUCTION" even for local/dev runs — make the gate env-aware when it centralizes into `beginEnvScopedOp` (the PR body's "clean fix"); (b) the dev-consequence banner shape (chalk.red.bold heading + red body + confirm-message suffix) is now duplicated between `retention/purge.ts` `approveDestructivePurge` and the inline block in `retention/notify.ts` — consolidate when a third destructive/outward-facing command appears; (c) cosmetic follow-on of (a): the composed dev confirmation reads "…via DEV, propagating by sync on PRODUCTION" — two colliding location references, resolved by the env-aware banner.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Real cost prevented — each new env-scoped command clones a ~12-line preamble and bumps the CPD baseline (already happened once for retention-backfill). A 0-callback extraction, still unbuilt. Evidence: `git grep -n "beginEnvScopedOp" packages/tooling` → no results, helper doesn't exist yet.
---
<!-- COMMENTS:END -->
