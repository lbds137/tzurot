---
id: TASK-936
title: >-
  gatewayServiceCalls.ts sits at 387 of 400 counted lines after the persona-DM
  stamp helper
status: To Do
assignee: []
created_date: '2026-09-11 23:21'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 934000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the persona-DM unreachability helper (reportPersonaDmUndeliverable, TASK-5) landed beside reportDeliveries in services/bot-client/src/utils/gatewayServiceCalls.ts and the file now counts 387 of 400 ESLint lines (skipBlankLines + skipComments probe, measured on the TASK-5 branch). The next helper added there hits the ceiling mid-unit and forces an unplanned extraction.
Fix shape: move the retention-adjacent seams (reportDeliveries, reportPersonaDmUndeliverable and their retry constants if any remain) into the sibling retentionNotifyGatewayCalls.ts, whose header states it was split out for budget alone and counts under 50 lines; rename it retentionGatewayCalls.ts if the name no longer fits, update importers and the colocated tests, and confirm knip and depcruise stay clean. One PR, no behavior change.
Acceptance: gatewayServiceCalls.ts counts under 340 lines and every moved helper keeps its test in the sibling test file.
<!-- SECTION:DESCRIPTION:END -->
