---
id: TASK-724
title: >-
  Flag-on empty-assistant-row skip desyncs shippedMessageIds from what actually
  ships
status: To Do
assignee: []
created_date: '2026-08-22 06:47'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 724000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2180 round-6 review (none blocking; flip-gated). RealMessagesBuilder skips an assistant row whose body renders empty (provider empty-content safety), but ContentBudgetManager.preselectHistory computes shippedMessageIds from selectedEntries BEFORE that render-time skip — so flag-on, an empty-content assistant turn is counted as shipped, excluded from LTM retrieval by filterShippedMemories, then silently dropped at render: invisible to the model AND un-backfilled by memory. Flag-off unaffected (XML always emits the element). Reachability of empty-content assistant rows in prod data is unverified either way.

Fix shape: exclude empty-body assistant rows at SELECTION time (selectCurrentChannelEntries or a pre-filter on selectedEntries) so the shipped-id set and the rendered set derive from the same list — plus a test covering the interaction between the two mechanisms. Alternatively verify prod unreachability and accept with a comment at the skip site.

Acceptance: shippedMessageIds and the flag-on rendered message set cannot disagree (test-pinned), or the row class is proven unreachable and the acceptance recorded. Gates the realMessagesEnabled flip alongside task-723.
<!-- SECTION:DESCRIPTION:END -->
