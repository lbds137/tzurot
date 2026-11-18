---
id: TASK-1459
title: Replace pendingReleases side map with explicit release-context passing
status: To Do
assignee: []
created_date: '2026-11-18T22:19:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: low
ordinal: 1459000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-66 review finding #5 refactor half (PR 2769). CoalescingHoldRegistry hands the released survivor its skippedMessages through a pendingReleases map keyed by (channelId, personalityId); the survivor consumes it by key in submitOrHoldSlot. This is race-free only while startFanOut reaches submitOrHoldSlot without inserting an extra await first — an unrelated trigger arriving in that window would consume the handoff and lose its row. Round 4 documented the invariant in JSDoc and fixed the leak (identity-checked finally cleanup), which is the minimum; this task is the structural fix: carry the release context on the fan-out input or resolved slot so no side map is needed. Acceptance: pendingReleases map deleted; the survivor receives its skipped list as data; all hold tests green.
<!-- SECTION:DESCRIPTION:END -->
