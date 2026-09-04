---
id: TASK-224
title: buildFullSystemPrompt runs 3× per generation for token counting
status: To Do
assignee: []
created_date: '2026-07-07 00:00'
updated_date: '2026-09-04 19:39'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 224000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`buildFullSystemPrompt` runs 3× per generation for token counting — Perf-only observation from external review: the prompt is assembled three times per generation just to count tokens. Act only if ai-worker CPU becomes a bottleneck — natural rider on the memory epic's budget refactor. (The two memory-visibility riders that shared this row shipped: incognito forget-count filter, and shapes-import dedup deliberately kept visibility-unfiltered so purged content is never resurrected — documented + pinned by test.) **Promote when**: ai-worker CPU profiling shows prompt assembly hot.

**Why:** Pure perf; no user-visible behavior at stake today. Surfaced 2026-07-07 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:39
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): RETARGET. buildFullSystemPrompt is now PromptBuilder.buildSystemMessage (zero hits for the old name outside tracker). The pattern survives: ContentBudgetManager.ts calls it from two budget-fitting sites plus the final assembly. Trigger unchanged: CPU profiling showing it hot.
---
<!-- COMMENTS:END -->
