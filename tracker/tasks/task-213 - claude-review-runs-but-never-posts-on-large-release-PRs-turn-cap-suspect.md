---
id: TASK-213
title: 'claude-review runs-but-never-posts on large release PRs (turn-cap suspect)'
status: To Do
assignee: []
created_date: '2026-07-06 00:00'
labels:
  - 'origin:review'
dependencies: []
ordinal: 213000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

claude-review runs-but-never-posts on large release PRs (turn-cap suspect)

**Why:** The beta.149 release PR's review executed fully TWICE (56-turn runs, `success`, 17 permission denials; no billing impact — the Action rides the Max plan) yet posted no comment — a NEW variant of the known completed-without-posting failure (previously: placeholder posts). RECURRED 2026-07-06 on feature PR #1506 (23 turns, 48 permission denials, no post; rerun posted fine at 8m) — the high denial count points at the action's TOOL PERMISSIONS as the likelier root cause than the turn cap: the agent burns turns attempting denied actions (possibly its own posting step) and completes without posting. **Fix shape**: raise/verify the action's max-turns for release-sized diffs, or make the workflow post a failure marker when the result contains no posted comment — workflow change ⇒ main-cut PR per the claude-workflow rule. **Promote when**: the next release PR review goes silent, or opportunistically with any claude-workflow maintenance. Surfaced 2026-07-06 (beta.149 release; owner manually re-triggered to get a posted review).
<!-- SECTION:DESCRIPTION:END -->
