---
id: TASK-21
title: confirmProductionOperation returns an ignorable boolean
status: To Do
assignee: []
created_date: '2026-07-10 00:00'
updated_date: '2026-07-28 10:46'
labels:
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-10 — `confirmProductionOperation` (tooling env-runner) returns a boolean that callers can silently discard, making the prod gate decorative (bit once: backfill-facts shipped the prompt without checking the result; caught in review). **Fix shape**: change the API to throw/exit on decline (or add `requireProductionConfirmation` and migrate the ~4 call sites), so the class of discarded-boolean gates becomes unrepresentable. **Promote when**: next tooling PR.

**Why:** A safety prompt that can be held wrong isn't a gate; API-level fix kills the class per the structural directive.
<!-- SECTION:DESCRIPTION:END -->
