---
id: TASK-1057
title: Retention live-run report footer reads as the kill switch current value
status: To Do
assignee: []
created_date: '2026-09-23 17:25'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1051000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the daily retention live-run embed footer ends "kill switch: RETENTION_AUTORUN_ENABLED=false" (services/bot-client/src/services/retentionRun/retentionRunReport.ts:259, a static string). Only live mode produces this embed, and live requires the switch ON (RetentionRunScheduler.ts mode table), so the footer names the value that would STOP autorun, not the current one. On 2026-09-23 the owner report of a "Purged: 4 of 4 eligible" run next to "=false" read as a purge with autorun off, and the assistant misread it the same way before checking the mode table.
Fix shape: reword to "to stop: set RETENTION_AUTORUN_ENABLED=false" (or "autorun ON · stop with ..."), and update the report test that pins the footer text.
Acceptance: the footer cannot be read as the current setting; the report test pins the new wording.
<!-- SECTION:DESCRIPTION:END -->
