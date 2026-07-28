---
id: TASK-307
title: Watch the bug-remediation first-fix trigger for over-firing
status: To Do
assignee: []
created_date: '2026-07-20 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'origin:review'
  - 'area:process'
  - 'size:S'
dependencies: []
priority: low
ordinal: 307000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-20 (#1731 r4 observation) — the bug-remediation skill-eval trigger was broadened to fire at the FIRST fix of a path-specific UI/flow bug (`delete/edit/create/browse/view button|flow|screen`, `doesn't show/appear`, `only shows after`). Intentionally broad so it fires on first-fix, not just recurrence — but if it fires on ordinary one-off UI bug reports often enough, the SKILL CHECK banner becomes noise the owner skims past, blunting the check-every-time effect. **Fix shape**: tighten the alternation (e.g. require a sibling-flow contrast like "after creation…after edit", or a component-family + malfunction pair) if it proves chatty. **Promote when**: the banner visibly over-fires on non-remediation prompts.

**Why:** A too-eager nudge trains skim-past, which defeats the nudge — watch real firing frequency before tightening.
<!-- SECTION:DESCRIPTION:END -->
