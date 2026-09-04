---
id: TASK-96
title: MultiTagRecovery background-run race with startResultsListener after timeout
status: To Do
assignee: []
created_date: '2026-05-16 00:00'
updated_date: '2026-09-04 19:38'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 96000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

MultiTagRecovery background-run race with `startResultsListener` after timeout

**Why:** When recovery exceeds the 30s `Promise.race` timeout in `index.ts`, the background `recovery.run()` continues iterating through remaining entries. Each `adoptRehydratedEntry` registers new jobIds in `jobToGroup`, but during the brief window between `chatManager.submitChatJob` returning a fresh jobId and `adoptRehydratedEntry`'s `jobToGroup.set` running, a result for that new jobId could arrive (via the already-started `startResultsListener`), find `ownsJob` false, and fall through to the single-personality path — bypassing slot ordering. **Low probability**: timeout implies degraded Discord, which also implies slow result delivery, narrowing the window. **Fix shape options**: (a) thread a cancellation token through recovery so the loop bails on timeout; (b) pre-populate `jobToGroup` per slot inside `rebuildSlot` immediately after `submitChatJob`; (c) accept the race and add a stronger comment. **Promote when**: if production logs show "recovery exceeded 30s" non-zero frequency, OR if the race surfaces as a missed-ordering bug. Surfaced 2026-05-16 PR #1034.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `rebuildSlot`/`adoptRehydratedEntry`/`jobToGroup` sequencing in `MultiTagRecovery.ts` is unchanged — none of the three named fix options (cancellation token, pre-populate jobToGroup, stronger comment) beyond the existing comment has landed. Low-probability race, real cost (missed slot ordering) if it fires. Promote-when (recovery-exceeded-30s logs, or an observed missed-ordering bug) hasn't been reported. Evidence: `git grep -n "jobToGroup.set\|adoptRehydratedEntry\|rebuildSlot"` shows the same sequence structure as described; comments at lines 382/482 describe but don't close the window.
---
<!-- COMMENTS:END -->
