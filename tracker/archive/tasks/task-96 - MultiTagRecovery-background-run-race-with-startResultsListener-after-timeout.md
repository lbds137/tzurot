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
author: backlog-pilot
created: 2026-11-26 23:41
---
CLOSED OBSOLETE (backlog pilot, 50-oldest sweep). The watched mechanism no longer exists — three shipped changes invalidated the premise since the 2026-09-04 KEEP pass: (1) `rebuildSlot` no longer submits any job — it polls BullMQ via `pollPriorJobState` and preserves the ORIGINAL jobId for in-flight slots (`services/bot-client/src/services/MultiTagRecovery.ts:386-461`, commit fdbe79d76 "poll BullMQ job state on MultiTagRecovery rehydration"); there is no `submitChatJob` call in the recovery path (grep count 0 on the file, re-verified 2026-11-26), so the "fresh jobId not yet in jobToGroup" window cannot occur. (2) Boot ordering changed: recovery runs BEFORE `startResultsListener` (`services/bot-client/src/index.ts:572-577`, comment "BOTH passes MUST run BEFORE startResultsListener"). (3) The timeout case is compensated: on deadline fire, `noteRecoveryMarkedStale()` arms the stale-check filter for results arriving while background recovery finishes (`index.ts:583-591`; `bootRecovery.ts:24` RECOVERY_TIMEOUT_MS=30_000). Related hardening commits: 1ea1895df, 62b6ef562, 603109de4. Option (c)'s "stronger comment" also exists — `MultiTagCoordinator.ts:210-231` documents a reorder closing the ownsJob window on the live fan-out path. Archived with reason in the removing commit; `pnpm tracker task restore 96` reverses.
---
<!-- COMMENTS:END -->
