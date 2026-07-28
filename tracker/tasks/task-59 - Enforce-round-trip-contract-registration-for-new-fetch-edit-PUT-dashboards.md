---
id: TASK-59
title: Enforce round-trip-contract registration for new fetch-edit-PUT dashboards
status: To Do
assignee: []
created_date: '2026-06-18 00:00'
updated_date: '2026-07-28 10:47'
labels:
  - 'area:bot-client'
  - 'area:testing'
  - 'size:S'
dependencies: []
priority: low
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Enforce round-trip-contract registration for new fetch-edit-PUT dashboards

**Why:** `updateSchemaRoundTrip.test.ts` (the avatarData-class guard, PR #1253) requires every fetch-edit-PUT dashboard to register in its `DASHBOARDS` array, but that requirement lives only in a file comment — no structural check catches a developer who adds a new dashboard and forgets to register it. **Fix options**: (a) a structural test that enumerates known update schemas / dashboard payload-builders and asserts each is registered (hard to fully automate — registration intent can't be auto-discovered, so this risks false negatives); (b) lighter — add the round-trip registry to `04-discord.md`'s Shared Utilities table so the "check for existing utilities" habit surfaces it, plus a one-line pointer in the dashboard-creation path. (b) is the pragmatic pick. **Promote when**: the next new fetch-edit-PUT dashboard is added (that's the moment the gap would bite). Surfaced by PR #1253 round-2 claude-review. Surfaced 2026-06-18 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->
