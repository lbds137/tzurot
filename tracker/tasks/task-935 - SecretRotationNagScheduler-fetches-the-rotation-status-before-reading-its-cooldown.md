---
id: TASK-935
title: >-
  SecretRotationNagScheduler fetches the rotation status before reading its
  cooldown
status: To Do
assignee: []
created_date: '2026-09-11 17:27'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 933000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: SecretRotationNagScheduler (services/bot-client/src/services/SecretRotationNagScheduler.ts, the secretRotationStatus call and the cooldown read that follows it) calls the gateway for the rotation status on every daily tick and reads the 7-day nag cooldown only afterwards, so a cooling week pays about seven gateway calls for nothing. Same shape as the retention nag defect fixed under TASK-932, found by that unit sweep; ReleaseFlagNagScheduler is NOT the same defect because its cooldown value is the nagged tag and the comparison needs the fetch.
Fix shape: read the cooldown first and return on non-null, then fetch the status; re-pin the test that asserts the old order and add one asserting the status call is skipped while cooling; rewrite the comment that justifies the old order.
Acceptance: a cooling tick makes one Redis get and no gateway call, pinned by a test that reddens when the two reads are swapped back.
<!-- SECTION:DESCRIPTION:END -->
