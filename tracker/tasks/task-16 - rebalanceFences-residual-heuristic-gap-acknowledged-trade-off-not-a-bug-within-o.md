---
id: TASK-16
title: 'rebalanceFences residual heuristic gap (acknowledged trade-off, not a bug): within one…'
status: To Do
assignee: []
created_date: '2026-07-12 00:00'
labels: []
dependencies: []
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-12 — `rebalanceFences` residual heuristic gap (acknowledged trade-off, not a bug): within one force-split oversized chunk, the odd/even `parity assumes every marker is a real fence boundary — a span containing BOTH a huge code block AND a stray unpaired` in surrounding prose could still mis-fence its own fragments. The simpler stray-backtick-in-untouched-chunk class is fixed and pinned; this compound case is inherent to parity counting. **Fix shape**: a real fence-state parser (line-context aware) replacing parity, if ever warranted. **Promote when**: a user-visible mis-fenced chunk is reported despite the scoped rebalancer. Surfaced by #1596 final review.

**Why:** Named residual of the fence fix; the doc comment on rebalanceFences states the soundness boundary.
<!-- SECTION:DESCRIPTION:END -->
