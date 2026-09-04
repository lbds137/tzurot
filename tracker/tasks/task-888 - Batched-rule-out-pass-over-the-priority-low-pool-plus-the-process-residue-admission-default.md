---
id: TASK-888
title: >-
  Batched rule-out pass over the priority-low pool, plus the process-residue
  admission default
status: To Do
assignee: []
created_date: '2026-09-04 11:58'
labels:
  - 'area:backlog'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 886000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: measured 2026-09-04 over five organic weeks (git adds vs status flips on tracker files, July import week excluded): 517 filed, 368 closed or archived, net about +30 per week despite 60 to 70 closed weekly. Of 440 open tasks, 287 are priority low and 124 are state:observable watches; only 7 are high. About 44 percent of the last four weeks of filings came from process areas (tooling, hooks, process, skills, rules, ci, docs), which are only 28 percent of the pool, so process work generates residue faster than it retires it. Outflow alone cannot win; doc-7 said so in July and the rates have not changed. Owner picked this lever on 2026-09-04 (AskUserQuestion: Batched rule-out pass, over watch-expiry-only and outflow-only).

What, two halves. (1) The pass: read every open priority-low task, sort each into KEEP (one-line reason: a named trigger or a real cost it prevents) or RULE-OUT (one-line technical reason, per 06-backlog section Ruling an item out), grouped by area, delivered as ONE digest the owner clears in a single sitting, TASK-599 shape. Rule-outs archive with the reason in the removing commit; keeps get their reason appended so the next pass does not re-read them from scratch. Council flag instead of a weak recommendation where the call is genuinely uncertain. (2) The admission default, a review-gated rule PR on 06-backlog.md: residue surfaced by process work (a hook, skill, rule, or tooling PR) is declined in that PR body by default unless it is medium priority or higher; low-priority process residue gets its disposition in the PR, not a task. This is the inflow half; the pass is the outflow half.

Acceptance: every priority-low task open at the start of the pass appears exactly once in the digest with a keep or rule-out line; every owner ruling lands on the task file or the archiving commit, not only in chat; the 06-backlog amendment merged; the digest reports the net (archived vs kept) and the weekly filed-vs-closed table re-measured at close. Scheduled for beta.217 (backlog/now.md Horizon).

Note: assistant-generated process work, owner-approved 2026-09-04; counts against the session net.
<!-- SECTION:DESCRIPTION:END -->
