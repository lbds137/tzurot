---
id: TASK-1283
title: >-
  Batch flows: counts-line wording untested + PAGE_FETCH_FAILED_COPY JSDoc
  overclaims + 2 inline copies
status: Done
assignee: []
created_date: '2026-10-25 02:11'
updated_date: '2026-10-25 18:30'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1271000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 2653 round-4 findings (none blocking, merged with this disposition):

1. The verb-dependent counts line (delete: locked (skipped) / lock: already locked) has no test - swapping the ternary arms leaves the suite green. Add a per-verb fallback followUp assertion (a lock run with one known-locked id expects already locked; a delete run expects locked (skipped)) + prove it red by swapping the arms.
2. multiSelectBatch.ts PAGE_FETCH_FAILED_COPY JSDoc says every batch flow entry and refusal paths quote identical copy - the memory confirm refusal deliberately differs (re-run copy, validation category; the strip removed every retryable affordance). Narrow the JSDoc to entry paths or note the exception.
3. browse.ts and search.ts inline the PAGE_FETCH_FAILED_COPY text - swap to the const (two lines).

Promote when: TASK-1254 lands (the third flow copies the shape; fix all three there in the same diff).
<!-- SECTION:DESCRIPTION:END -->
