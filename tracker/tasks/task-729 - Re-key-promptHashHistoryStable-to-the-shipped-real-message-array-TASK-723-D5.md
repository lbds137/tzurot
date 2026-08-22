---
id: TASK-729
title: Re-key promptHashHistoryStable to the shipped real-message array (TASK-723 D5)
status: Done
assignee: []
created_date: '2026-08-22 13:47'
updated_date: '2026-08-22 21:53'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 729000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: flag-on serializedHistory ships empty (ContentBudgetManager.ts:378) so promptHashHistoryStable silently vanishes (cacheObservability.ts:223 gates on it) — the stable-prefix diagnostic the 2.5 staged rollout leans on measures nothing in exactly the mode being rolled out. Design record: prompt-assembly-architecture.md 9d D5.
What: flag-on, derive the stable-history hash from the shipped array — crossChannelMessage (when present) plus history messages minus the newest — mirroring the flag-off chat-log-minus-newest semantic. Flag-off byte-identical hash inputs.
Acceptance: flag-on generations log promptHashHistoryStable again; test pins the minus-newest semantic in both modes. Must merge BEFORE the flip PR.
<!-- SECTION:DESCRIPTION:END -->
