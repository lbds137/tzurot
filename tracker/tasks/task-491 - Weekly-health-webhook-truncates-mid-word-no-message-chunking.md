---
id: TASK-491
title: Weekly health webhook truncates mid-word - no message chunking
status: Done
assignee: []
created_date: '2026-08-09 17:01'
updated_date: '2026-08-10 11:37'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 491000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner report 2026-08-09 - the weekly audit-health Discord webhook message cut off mid-word ("repository response has no boo") at the Repo deletion-safety section, so the tail of the report (including a warning) is silently lost every week the report exceeds the Discord message cap.
What: chunk the health-report webhook post at safe boundaries (split on section headers or newlines under the 2000-char message limit, post as sequential messages), or move to embeds with per-section fields. Find the poster in packages/tooling (ops health / audit summary webhook path).
Acceptance: a report longer than one Discord message arrives complete across N messages, split at line boundaries never mid-word; verified against the current report length.
<!-- SECTION:DESCRIPTION:END -->
