---
id: TASK-1432
title: >-
  Unify catalog price parsing and accept a string tier threshold in
  diagnosticCost
status: Done
assignee: []
created_date: '2026-11-17T02:22:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1432000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to PR 2758 round-4 review (Lila chose merge + follow-up in beta.246).

1. matchedTierThreshold skips a min_prompt_tokens sent as a numeric string with no log, which under-prices a >100k turn 5x. Accept a numeric string through the same Number() path, and pin it with a test.
2. parseUsablePrice uses parseFloat (accepts "0.1abc") while isNumericString uses Number(); one parser for both, so price-shaped means the same on the base entry and inside an override.
3. cacheCaveat zero-delta form uses ", cache-aware"; make it "; cache-aware" like the other two forms.

Files: services/api-gateway/src/services/diagnosticCost.ts, services/bot-client/src/commands/inspect/costLine.ts.
Acceptance: tests pin each item; live catalog behaviour unchanged.
<!-- SECTION:DESCRIPTION:END -->
