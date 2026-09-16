---
id: TASK-994
title: >-
  Cross-channel history budget starves the most recent channel: groups are
  consumed oldest-first
status: Done
assignee: []
created_date: '2026-09-16 20:17'
updated_date: '2026-09-16 23:46'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 990000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: CrossChannelSerializer.ts documents its input groups as most-recent-channel-first, but the producer sorts channel groups oldest-first on purpose, and the token-budget loop consumes the groups in array order. Under budget pressure the channel the user talked in most recently is the one truncated or dropped, which is the opposite of what a continuity feed should keep. Found by reading, not runtime-confirmed; the grounding report docs/local/handoffs/ground-doc97p4-A-history.md (gitignored) cites both sites as S1.
Fix shape: decide the intended order once (most-recent-first for the budget, then re-sort for render if chronological display is wanted), fix the producer or the serializer to match the doc comment, and pin with a test whose fixture has three channels over budget and asserts the newest survives. The doc-97 Phase 4 design may replace the feed with a digest; if it does, this closes as obsolete, otherwise it ships as a fix.
Acceptance: with three channels and a budget that fits two, the most recent channel renders in full.
Found by the doc-97 Phase 4 grounding pass, 2026-09-16.
<!-- SECTION:DESCRIPTION:END -->
