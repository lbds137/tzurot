---
id: TASK-1090
title: 'backlog:digest prints the cold/queue.md Half-finished section'
status: To Do
assignee: []
created_date: '2026-09-24 21:13'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1083000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the 2026-09-24 sweep found three epics with shipped work and a remainder no board named; the fix is a Half-finished section in backlog/cold/queue.md, but cold files are grep-on-demand, so nothing re-surfaces the section weekly. The digest is the session-start briefing.
Fix shape: backlog:digest parses the Half-finished section (one row per epic: doc id, remainder, bin, trigger) and prints it after the owner queue; backlogLint checks the section exists and every row names a bin from the fixed set (gated / owner / pivoted). Process task, agent-generated, counted against the drain net.
Acceptance: the digest shows the rows; a row with an unknown bin fails pnpm ops backlog.
<!-- SECTION:DESCRIPTION:END -->
