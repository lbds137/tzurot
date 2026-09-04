---
id: TASK-772
title: >-
  Give hard-failure synthesized notices the personality error voice and a real
  category
status: To Do
assignee: []
created_date: '2026-08-25 18:38'
updated_date: '2026-09-04 19:38'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 772000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: JobFailureListener synthesizes hard-failure results with no errorInfo and no personalityErrorMessage, so the user-facing notice always falls to the generic DEFAULT_ERROR (breaking character — soft failures speak in the personality error voice) and the owner-channel report lands in the unknown bucket. Meets TASK-111 acceptance as shipped (brief could-not-complete notice was the decided shape); this is the enhancement beyond it, surfaced by PR 2221 round-4 review.

Fix shape: the tracker context available in the legacy branch carries personality — thread personalityErrorMessage (context.personality.errorMessage) into buildSyntheticFailure for the single-tag arm, and decide whether the multi-tag arm can do the same per-slot (the shapes are deliberately shared today; diverging them needs a look). A category better than unknown likely means mapping the BullMQ failedReason through the existing parser rather than inventing classification in bot-client — check the boundary before building.

Acceptance: a hard-failed single-tag turn renders the personality error voice when one is configured; the owner report carries a non-unknown category or a recorded decision that unknown is correct; both pinned by seam tests.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Confirmed unaddressed — `buildSyntheticFailure` still builds a bare `{ requestId, success: false, error }` with no `personalityErrorMessage` or real category threaded through. Evidence: `sed -n '43,52p' services/bot-client/src/services/JobFailureListener.ts` → no `personalityErrorMessage` or `errorInfo` field in the synthesized `LLMGenerationResult`.
---
<!-- COMMENTS:END -->
