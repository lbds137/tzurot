---
id: TASK-217
title: 'Retire the memoryScoreThreshold knob (and audit memoryLimit)'
status: To Do
assignee: []
created_date: '2026-07-06 00:00'
labels: []
dependencies: []
ordinal: 217000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Retire the `memoryScoreThreshold` knob (and audit `memoryLimit`)

**Why:** Data-verified 2026-07-06: every llm_config on BOTH dev and prod sits at the 0.50 default — the knob has never been adjusted by anyone; it is shapes.inc-parity inheritance (owner: parity is no longer a goal). Retiring it removes a schema column, a dashboard field, Zod bounds in 3 schemas, and the cascade-override plumbing — the same retirement muscle as the legacy-column theme. Interacts with the parked hybrid-retrieval branch (threshold gates only the dense arm there) and Phase 1b composite scoring (which may replace it wholesale) — retire alongside one of those rather than standalone. **Promote when**: Phase 1b composite scoring is designed, or the parked hybrid branch resumes.
<!-- SECTION:DESCRIPTION:END -->
