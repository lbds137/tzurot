---
id: TASK-30
title: >-
  Bootstrap reseed can override an admin-nulled TTS default pointer (extreme
  sequence)
status: To Do
assignee: []
created_date: '2026-07-02 00:00'
updated_date: '2026-07-28 10:46'
labels:
  - 'area:voice'
  - 'origin:review'
  - 'size:S'
dependencies: []
priority: low
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Bootstrap reseed can override an admin-nulled TTS default pointer (extreme sequence)

**Why:** If an admin explicitly NULLs a TTS default pointer AND all global TTS configs are later deleted (only possible once the pointer is null — the delete guard no longer blocks), the next `list(GLOBAL)` re-triggers `bootstrapTtsSystemGlobalsIfNeeded`, which reseeds BOTH pointers to kyutai — silently overriding the earlier explicit-null choice. Accepted tradeoff for now (a wiped-globals fresh state SHOULD converge to working defaults; the sequence is extreme), but undocumented. **Fix shape**: one comment at `seedDefaultPointersIfUnset` noting the tradeoff, or a sentinel distinguishing admin-nulled from never-set. **Promote when**: explicit-null pointer semantics become a real admin workflow. Surfaced 2026-07-02 (#1446 round-2 review).
<!-- SECTION:DESCRIPTION:END -->
