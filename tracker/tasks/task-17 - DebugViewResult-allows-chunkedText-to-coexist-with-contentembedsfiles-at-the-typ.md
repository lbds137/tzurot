---
id: TASK-17
title: 'DebugViewResult: make chunkedText vs content exclusivity compiler-enforced'
status: To Do
assignee: []
created_date: '2026-07-11 00:00'
updated_date: '2026-09-04 19:35'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-11 — `DebugViewResult` allows `chunkedText` to coexist with `content`/`embeds`/`files` at the type level while `renderViewResult` silently prefers `chunkedText` — a discriminated union would make the exclusivity compiler-enforced. (The sibling `embeds: []` nit shipped with the rendering-hardening PR.) Converting ripples through every view builder + test, so it waits for a natural rewrite. **Promote when**: adding an /inspect view or reworking DebugViewResult. Surfaced by #1588 round-6 review.

**Why:** Latent trap for the NEXT contributor; harmless in current call graphs.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:35
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `DebugViewResult` (`commands/inspect/views.ts:37`) still lets `chunkedText` coexist with `content`/`embeds`/`files` at the type level — no discriminated union. Latent trap for the next contributor; waits for a natural rewrite (no promote-when has fired). Evidence: `git grep -n "interface DebugViewResult"` → confirmed all fields present as siblings, no union.
---
<!-- COMMENTS:END -->
