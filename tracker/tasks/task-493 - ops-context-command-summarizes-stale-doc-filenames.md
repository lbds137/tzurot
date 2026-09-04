---
id: TASK-493
title: ops context command summarizes stale doc filenames
status: To Do
assignee: []
created_date: '2026-08-09 18:25'
updated_date: '2026-09-04 19:37'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. The bug is unchanged — `session-context.ts`/`session-state.ts` still hardcode `CURRENT_WORK.md` and `ROADMAP.md`, neither of which exists in this repo (it's `CURRENT.md`/`BACKLOG.md`), so the doc-summary step still silently reports nothing. Evidence: `git grep -n "CURRENT_WORK\|ROADMAP.md" packages/tooling/src/context/session-context.ts` → still present at lines 88, 352, 507, 510.
---
<!-- COMMENTS:END -->
