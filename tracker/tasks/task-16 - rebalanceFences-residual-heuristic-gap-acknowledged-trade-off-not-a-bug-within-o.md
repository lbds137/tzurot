---
id: TASK-16
title: 'rebalanceFences residual: parity heuristic vs a real fence parser'
status: To Do
assignee: []
created_date: '2026-07-12 00:00'
updated_date: '2026-09-04 19:35'
labels:
  - 'area:common-types'
  - 'size:L'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-12 — `rebalanceFences` residual heuristic gap (acknowledged trade-off, not a bug): within one force-split oversized chunk, the odd/even `parity assumes every marker is a real fence boundary — a span containing BOTH a huge code block AND a stray unpaired` in surrounding prose could still mis-fence its own fragments. The simpler stray-backtick-in-untouched-chunk class is fixed and pinned; this compound case is inherent to parity counting. **Fix shape**: a real fence-state parser (line-context aware) replacing parity, if ever warranted. **Promote when**: a user-visible mis-fenced chunk is reported despite the scoped rebalancer. Surfaced by #1596 final review.

**Why:** Named residual of the fence fix; the doc comment on rebalanceFences states the soundness boundary.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:35
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. The compound mis-fencing gap the task describes is still exactly what the current doc comment states as the function's soundness boundary — the code hasn't changed to close it, and the promote-when trigger (a user-visible mis-fenced chunk report) hasn't fired. Evidence: `sed -n '428,445p' packages/common-types/src/utils/discord.ts` — JSDoc above `rebalanceFences` still reads "the parity heuristic is only sound within a group that genuinely contained a cut fence."
---
<!-- COMMENTS:END -->
