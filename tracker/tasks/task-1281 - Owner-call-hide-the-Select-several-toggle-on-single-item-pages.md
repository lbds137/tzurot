---
id: TASK-1281
title: 'Owner call: hide the Select-several toggle on single-item pages?'
status: To Do
assignee: []
created_date: '2026-10-25 01:07'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 1269000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 2653 round-2 finding (Low/UX): on a page with one item the multi-select caps at max 1, so the toggle is a longer route to what the single-pick select already does. Reviewer suggests rendering the toggle only when facts.length >= 2. Product call, owner decides.

Owner question: hide the Select several toggle when the page has fewer than 2 items?
Recommendation: keep it visible — consistent affordance across pages beats saving one redundant tap; revisit if it reads as clutter.

Touch point: factsBrowse.ts toggle render + memoriesBatch.ts buildBatchSelectComponents (both flows).
<!-- SECTION:DESCRIPTION:END -->
