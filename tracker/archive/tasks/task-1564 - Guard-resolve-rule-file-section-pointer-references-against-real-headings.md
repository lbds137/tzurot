---
id: TASK-1564
title: 'Guard: resolve rule-file section-pointer references against real headings'
status: To Do
assignee: []
created_date: '2026-11-27T00:23:00Z'
labels:
  - area:tooling
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1558000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: nine stale section pointers surfaced across two review rounds on PR 2822 alone; nothing validates rule-file section references against the named headings, so rule reshuffles ship stale pointers that only review catches.
What: an ops guard in the spirit of guard:commit-scope-sync that greps section references into .claude/rules/*.md across rules, skills, docs and code comments, and fails when the named heading does not exist in the referenced file; wire into the quality chain.
Promote when: the next rule reshuffle lands, or immediately at the next tooling-DRY pass.

Folded into TASK-1110 as its third pointer family (PR 2822 review round 3, 2026-11-26) — archived rather than shipped as its own task; the work is tracked in TASK-1110's description (one resolver, two modes).
<!-- SECTION:DESCRIPTION:END -->
