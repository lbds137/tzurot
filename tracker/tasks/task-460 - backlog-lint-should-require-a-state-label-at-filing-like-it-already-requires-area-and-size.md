---
id: TASK-460
title: >-
  backlog lint should require a state label at filing, like it already requires
  area and size
status: Done
assignee: []
created_date: '2026-08-07 13:11'
updated_date: '2026-08-07 16:59'
labels:
  - 'area:backlog'
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 459000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The state labels (ready, observable, dependent, owner, unreachable) come from a one-time labeling pass over the open set. Nothing enforces them at filing, so every task created since carries none — and the drain query documented in CURRENT.md as the selection mechanism filters on exactly that label. Four tasks filed on 2026-08-06 were invisible to it until noticed by hand.

This is the same failure shape as a rule that claims enforcement it does not have: the label looks like part of the system because the existing 300 tasks have one, so nobody checks whether new ones do.

pnpm ops backlog already hard-fails an open task missing an area label, missing or duplicated size, or missing priority — the stated reason being that those are the axes every selection query filters on. state is also such an axis, arguably the sharpest one since it separates workable from parked. The asymmetry is the bug.

Fix shape: add the state check beside the existing three in the open-task triage validation. One label, from the fixed set, on every open task. Expect a one-time sweep to label whatever is currently missing before the gate can go green.

Acceptance: filing a task without a state label fails pnpm ops backlog with a message naming the valid values; the drain query can no longer miss a task purely because it was filed after the labeling pass.
<!-- SECTION:DESCRIPTION:END -->
