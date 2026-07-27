---
id: TASK-311
title: "/help's execute routes 'getting-started' explicitly and falls through to the commands…"
status: To Do
assignee: []
created_date: '2026-07-21 00:00'
labels:
  - 'area:db'
  - 'origin:review'
dependencies: []
ordinal: 311000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-21 (#1750 claude-review) — `/help`'s execute routes `'getting-started'` explicitly and falls through to the commands browser otherwise. Safe with exactly two subcommands (Discord guarantees one fires), but a third section (`faq`, `migration`) added without updating the branch silently lands in the commands browser instead of erroring. **Fix shape**: explicit `switch` over subcommand names with an unrouted-error default, in the same PR that adds the third section. **Promote when**: a third `/help` subcommand lands.

**Why:** Preemptive exhaustiveness over two values is ceremony; the fix is 5 lines exactly when the trigger fires — reviewer and agent agreed "not worth doing now".
<!-- SECTION:DESCRIPTION:END -->
