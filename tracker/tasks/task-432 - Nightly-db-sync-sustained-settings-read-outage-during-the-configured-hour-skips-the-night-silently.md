---
id: TASK-432
title: >-
  Nightly db-sync: sustained settings-read outage during the configured hour
  skips the night silently
status: To Do
assignee: []
created_date: '2026-08-04 20:13'
updated_date: '2026-09-04 19:37'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Still only `logger.warn` on a settings-read failure; every other nightly-sync failure path posts to the owner channel except this one. Evidence: `sed -n '140,200p' services/bot-client/src/services/NightlyDbSyncScheduler.ts` → `shouldSyncThisTick` returns `false` with only a `logger.warn` when settings are unreadable; `postOwnerChannelEmbed` is called only from the `dbSync` failure branch further down.
---
<!-- COMMENTS:END -->
