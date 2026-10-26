---
id: TASK-1297
title: >-
  multiSelectBatch: type-only wasSet assert and an @see from the clamp to its
  detector
status: To Do
assignee: []
created_date: '2026-10-26T16:25:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1283000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2665 review round 4 (owner chose merge-as-is at the round cap). Two cosmetic follow-ups. What: (1) services/bot-client/src/utils/overrideBrowseBatch.ts WAS_SET_TYPES_MATCH is a runtime const plus a void statement carrying a type-only check; replace with a type-level form (type Assert<T extends true> = T; an alias over IsSame) if lint accepts an unused alias, and drop the now-redundant half of the DeleteOverrideWasSet intersection. (2) services/bot-client/src/utils/browse/multiSelectBatch.ts clampBatchConfirmDescription gets a one-line @see recoverConfirmListingLabels, because the detector depends on the clamp producing exactly the budget (or budget-1) length, and that coupling is visible only from the reader side today. Acceptance: bot-client typecheck still fails when one schema changes the wasSet type (the existing canary), and the @see is present.
<!-- SECTION:DESCRIPTION:END -->
