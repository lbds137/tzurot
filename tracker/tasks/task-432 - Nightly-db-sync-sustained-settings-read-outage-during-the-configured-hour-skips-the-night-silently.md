---
id: TASK-432
title: >-
  Nightly db-sync: sustained settings-read outage during the configured hour
  skips the night silently
status: To Do
assignee: []
created_date: '2026-08-04 20:13'
updated_date: '2026-08-04 20:13'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 432000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: shouldSyncThisTick fails closed (correct) but only logger.warn — if getSystemSettings fails on all ~4 ticks inside the configured hour, that night is skipped with no owner-channel post. Every other failure path notifies. Surfaced by claude-review on the PR that added wall-clock scheduling.
Fix shape: a once-per-day fallback check (e.g. on the first tick AFTER the configured hour, if no cooldown key exists, post a "nightly sync did not run" notice) — avoids per-tick spam while closing the silent-miss gap.
Acceptance: a simulated all-ticks-fail hour produces exactly one owner-channel notice; healthy nights produce none.
<!-- SECTION:DESCRIPTION:END -->
