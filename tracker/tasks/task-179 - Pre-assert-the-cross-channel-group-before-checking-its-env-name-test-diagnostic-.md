---
id: TASK-179
title: >-
  Pre-assert the cross-channel group before checking its env name (test
  diagnostic clarity)
status: To Do
assignee: []
created_date: '2026-06-25 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:ai-worker'
  - 'area:testing'
  - 'size:S'
dependencies: []
priority: low
ordinal: 179000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Pre-assert the cross-channel group before checking its env name (test diagnostic clarity)

**Why:** In `ContextAssembler.component.test.ts` the cross-channel decoration test does `expect(byChannel(CHANNEL_ID_C)?.channel.name).toBe('unknown-channel')`. If the group were absent entirely (e.g. a DB query silently filtering it), the failure reads `expected undefined to equal 'unknown-channel'` — ambiguous between "wrong name" and "group not found." **Fix shape**: pre-assert `expect(envC).toBeDefined()` before the name check (same for B). Pure diagnostic-clarity; the current form still catches real regressions. **Promote when**: next touching that test file. Surfaced 2026-06-25 by PR #1345 round-3 claude-review (non-blocking, optional).
<!-- SECTION:DESCRIPTION:END -->
