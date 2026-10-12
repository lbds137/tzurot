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

Not a duplicate of TASK-16 (now merged below as the real-fence-parser member): that one is about the parity heuristic inside rebalanceFences being unsound for a compound span. This one is that splitMessageByLines has no fence handling at all.

Fix shape: do NOT simply run rebalanceFences over splitMessageByLines output. Its own doc comment warns that applying the parity heuristic across never-split chunks lets a stray unpaired marker elsewhere inject phantom fences, which is why splitMessage scopes it to the fragments of one oversized chunk. The likely-correct shape is the placeholder approach splitMessage already uses: treat each fenced block as an atomic unit, split by lines around it, and only force-split a fence that alone exceeds the cap. Needs a design pass over both splitters rather than a bolt-on, hence size M.

Acceptance: a fenced block inside line-aware chunked content either stays whole or is closed and reopened at each boundary, pinned by a test over a real db-sync report large enough to straddle; the health webhook path, which documents its own content as fence-free, is unchanged.

## Merged from TASK-16 (2026-10-12)

TASK-16 (priority low, size L, state:observable) is the "real fence parser" end state of this design pass, and a member of it: `rebalanceFences` residual, parity heuristic vs a real fence parser. Surfaced 2026-07-12 by the #1596 final review. Within one force-split oversized chunk, the odd/even parity assumes every marker is a real fence boundary; a span containing BOTH a huge code block AND a stray unpaired marker in surrounding prose could still mis-fence its own fragments. The simpler stray-backtick-in-untouched-chunk class is fixed and pinned; this compound case is inherent to parity counting (the JSDoc above `rebalanceFences` in packages/common-types/src/utils/discord.ts states the soundness boundary: "the parity heuristic is only sound within a group that genuinely contained a cut fence"; re-confirmed unchanged by the 2026-09-04 digest pass). Fix shape: a real fence-state parser (line-context aware) replacing parity. The design pass over both splitters should decide whether to build that parser: if `splitMessageByLines` and `splitMessage` both move to a fence-aware atomic-unit model, parity counting may go away entirely and this member closes with it. Original trigger: a user-visible mis-fenced chunk reported despite the scoped rebalancer. Note the distinction recorded at filing: TASK-16 is about the parity heuristic inside `rebalanceFences`; this task is that `splitMessageByLines` has no fence handling at all.
<!-- SECTION:DESCRIPTION:END -->
