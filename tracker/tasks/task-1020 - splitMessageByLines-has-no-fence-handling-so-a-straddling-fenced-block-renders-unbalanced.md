---
id: TASK-1020
title: >-
  splitMessageByLines has no fence handling, so a straddling fenced block
  renders unbalanced
status: To Do
assignee: []
created_date: '2026-09-18 21:52'
labels:
  - 'area:common-types'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1016000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: shipped knowingly with the TASK-1015 fix (PR for fix/db-sync-line-aware-chunking). sendChunkedReply gained a lineAware option selecting splitMessageByLines, which preserves newlines but does NOT protect or rebalance triple-backtick fences. The db-sync report wraps its per-table stats in a fence (buildStatsSection in services/bot-client/src/utils/dbSyncSummary.ts pushes the fence markers), so a large sync straddles it. Measured on a real 50-table report, 2468 chars, 61 newlines: splitMessage keeps 6 newlines and balances the fence; splitMessageByLines keeps 60 newlines and leaves the fence unbalanced across the straddled pair. Net still a large improvement, because splitMessage destroys the whole report, but the unbalanced fence is a real user-visible rendering defect and was accepted, not fixed.

Not a duplicate of TASK-16: that one is about the parity heuristic inside rebalanceFences being unsound for a compound span. This one is that splitMessageByLines has no fence handling at all.

Fix shape: do NOT simply run rebalanceFences over splitMessageByLines output. Its own doc comment warns that applying the parity heuristic across never-split chunks lets a stray unpaired marker elsewhere inject phantom fences, which is why splitMessage scopes it to the fragments of one oversized chunk. The likely-correct shape is the placeholder approach splitMessage already uses: treat each fenced block as an atomic unit, split by lines around it, and only force-split a fence that alone exceeds the cap. Needs a design pass over both splitters rather than a bolt-on, hence size M.

Acceptance: a fenced block inside line-aware chunked content either stays whole or is closed and reopened at each boundary, pinned by a test over a real db-sync report large enough to straddle; the health webhook path, which documents its own content as fence-free, is unchanged.
<!-- SECTION:DESCRIPTION:END -->
