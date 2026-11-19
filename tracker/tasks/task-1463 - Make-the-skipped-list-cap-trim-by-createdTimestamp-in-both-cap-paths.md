---
id: TASK-1463
title: Make the skipped-list cap trim by createdTimestamp in both cap paths
status: To Do
assignee: []
created_date: '2026-11-19T06:40:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1463000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-66 PR 2769 rounds 6-7. pushToSkippedLists appends in save-resolution order and trims from the front at the cap, so it can drop a newer-by-timestamp trigger while keeping an older one; mergeSkippedForSurvivor sorts by createdTimestamp before trimming, so the two cap paths disagree and the dropping-oldest docstring is only half true. Fix: insert in timestamp order (or sort before trimming) in pushToSkippedLists, keeping the wire and context lists aligned. Test gap: the current cap test feeds messages in order; add an out-of-order arrival that hits the cap. Acceptance: both cap paths drop oldest by createdTimestamp; out-of-order cap test green.
<!-- SECTION:DESCRIPTION:END -->
