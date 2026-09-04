---
id: TASK-203
title: Sweep remaining high-cardinality vision INFO logs if noise resurfaces
status: To Do
assignee: []
created_date: '2026-07-04 00:00'
updated_date: '2026-09-04 19:39'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 203000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Sweep remaining high-cardinality vision INFO logs if noise resurfaces

**Why:** #1487 demoted 11 per-image/per-turn vision INFO sites; the reviewer flagged that other pipeline files (e.g. `ragVisionAuth.ts`, job-chain `DependencyStep`) may carry similar per-image INFO traces not in that sweep. **Fix shape**: grep `logger.info` across the vision/job-chain path, classify per-image vs per-request, demote the plumbing. **Promote when**: vision log volume is a problem again during an investigation. Filed 2026-07-04 (#1487 review nit). Also sweep the 3 stale `[Image unavailable: …]` doc-comment mentions in `VisionProcessor.ts` (lines ~39/135/494 — comment-only, describe the retired format).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:39
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): NARROWED. ragVisionAuth.ts has zero info/debug logs and DependencyStep.ts logs per-job aggregates only; two of three stale doc comments already swept. Remaining: one stale [Image unavailable] comment at VisionProcessor.ts:116, plus the unfired volume watch.
---
<!-- COMMENTS:END -->
