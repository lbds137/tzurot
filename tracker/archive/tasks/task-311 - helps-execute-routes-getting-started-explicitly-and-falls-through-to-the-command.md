---
id: TASK-311
title: '/help subcommand routing: explicit switch when a third section lands'
status: To Do
assignee: []
created_date: '2026-07-21 00:00'
updated_date: '2026-09-04 19:44'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 311000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-21 (#1750 claude-review) — `/help`'s execute routes `'getting-started'` explicitly and falls through to the commands browser otherwise. Safe with exactly two subcommands (Discord guarantees one fires), but a third section (`faq`, `migration`) added without updating the branch silently lands in the commands browser instead of erroring. **Fix shape**: explicit `switch` over subcommand names with an unrouted-error default, in the same PR that adds the third section. **Promote when**: a third `/help` subcommand lands.

**Why:** Preemptive exhaustiveness over two values is ceremony; the fix is 5 lines exactly when the trigger fires — reviewer and agent agreed "not worth doing now".
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:44
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: ARCHIVED. admission bar (06-backlog.md: there is deliberately no state for the-only-trigger-is-next-time-someone-touches-this; a task in it should never have been filed). The trigger event and the need are the same diff: the third /help subcommand is added to the two-branch if.
---
<!-- COMMENTS:END -->
