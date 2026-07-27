---
id: TASK-54
title: 'guard:boundaries --summary mode not yet wired'
status: To Do
assignee: []
created_date: '2026-06-17 00:00'
labels:
  - 'area:tooling'
dependencies: []
ordinal: 54000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`guard:boundaries` `--summary` mode not yet wired

**Why:** `guard:boundaries` is a registered CI gate but its `--summary` JSONL line (for the future audit-aggregator) isn't emitted yet; hard-fail works independently of `--summary`. **Promote when**: the `ops:health` aggregator is built and needs the summary line, OR opportunistically when next touching `packages/tooling/src/dev/check-boundaries.ts`. Carried from the old quick-wins list during the 2026-06-17 backlog restructure.
<!-- SECTION:DESCRIPTION:END -->
