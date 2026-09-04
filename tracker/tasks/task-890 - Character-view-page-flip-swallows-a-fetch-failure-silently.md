---
id: TASK-890
title: Character view page flip swallows a fetch failure silently
status: To Do
assignee: []
created_date: '2026-09-04 20:51'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 888000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/bot-client/src/commands/character/view.ts (the catch near the comment Keep existing content on error - user can try again) logs a failed page flip and leaves the view unchanged, so the user clicks and nothing happens. The same symptom on the five browse pagination surfaces was closed by the shared followUpBrowsePageFailure helper (utils/browse/pageLoadFailure.ts), decided once at the builder level per TASK-294. The view page flip is a different flow with its own handler, so it was left out of that sweep deliberately rather than swept silently.
Fix shape: decide whether the ephemeral follow-up is the right shape for a view page flip too; if yes, call followUpBrowsePageFailure (or a view-named sibling) from that catch and add the followUp seam assertion to view.test.ts, mirroring the browse tests.
Acceptance: a failed view page flip either follows up ephemerally or the decision not to is recorded here with its reason.
<!-- SECTION:DESCRIPTION:END -->
