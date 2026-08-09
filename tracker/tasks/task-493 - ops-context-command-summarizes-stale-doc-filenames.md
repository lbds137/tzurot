---
id: TASK-493
title: ops context command summarizes stale doc filenames
status: To Do
assignee: []
created_date: '2026-08-09 18:25'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 493000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: doc-64 Phase 0 sweep (doc-69) found `pnpm ops context` hardcodes CURRENT_WORK.md and ROADMAP.md in its doc-summary step - neither file exists; the repo uses CURRENT.md / BACKLOG.md, so the summary silently reports nothing.
Fix shape: point the doc-summary filenames at CURRENT.md (and BACKLOG.md if useful) in packages/tooling/src (grep CURRENT_WORK to find the site); or drop the doc-summary step if the command is otherwise unused - check knip/usage first.
Acceptance: ops context reports real doc state, or the dead step is removed with rationale in the commit.
<!-- SECTION:DESCRIPTION:END -->
