---
id: TASK-579
title: >-
  Consolidate the per-prompt transcript tail+jq pass when a third
  UserPromptSubmit hook needs it
status: To Do
assignee: []
created_date: '2026-08-12 23:18'
updated_date: '2026-08-14 01:04'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 579000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: context-size-reminder.sh and queued-message-receipt.sh each run their own tail -c 4000000 | jq -R pass on EVERY user prompt - individually cheap, paid twice per prompt on a resource-constrained machine. Reviewer data point (#2081 round 2, explicitly no-action-now): if a THIRD similarly-shaped hook arrives, consolidate to one shared transcript-tail extraction the hooks consume, instead of a third pipeline.

Acceptance: named trigger only - at the third transcript-reading UserPromptSubmit hook, one tail+jq pass total.
<!-- SECTION:DESCRIPTION:END -->
