---
id: TASK-725
title: >-
  Flag-on real-messages render runs 3x per shipped entry (measure, re-measure,
  ship)
status: To Do
assignee: []
created_date: '2026-08-22 11:11'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 725000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2181 review (round 2, LOW/efficiency, non-blocking; also flagged in round 1). Flag-on, each selected history entry is rendered three times: renderHistoryEntryForMeasure during selection (via measureHistoryEntryRealTokens in ContextWindowManager.selectCurrentChannelEntries), buildRealMessages in ContextWindowManager.measureRealMessagesTokens for exact historyTokensUsed, and buildRealMessages again in ContentBudgetManager.allocate to build the shipped messages. All three sites carry comments justifying the trade (deterministic, cheap string work over a bounded window).

Fix shape: thread the built messages instead of rebuilding — e.g. selectAndSerializeHistory returns the flag-on BaseMessage array alongside selectedEntries (or PreselectedHistory carries it), allocate consumes it directly. Requires care that the measure and the shipped build cannot drift (the whole reason the re-measure exists).

Acceptance: at most one buildRealMessages pass per turn flag-on, with a seam test pinning that the measured and shipped forms remain identical. Promote when: profiling shows render cost matters, or history windows grow well past the current ~100-entry cap.
<!-- SECTION:DESCRIPTION:END -->
