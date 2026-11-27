---
id: TASK-1566
title: 00 baseline-refresh bullet is stricter than the 08 rule it summarises
status: To Do
assignee: []
created_date: '2026-11-27T04:26:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1559000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the round-8 always-loaded bullet in 00-critical Test Coverage Baseline says test:audit --update and mutation:update-baseline run ONLY after closing coverage/score gaps. 08 sanctions refreshes without closed gaps for measurement-basis changes: a Stryker major bump (task-655 describes exactly this sanctioned case) and package onboarding (mutation-check.WHY.md Onboarding). The always-loaded copy forbids both and is what every session sees.

What: reword the bullet to: run only after closing the gaps behind a genuine drop, or for a measurement-basis change (tool bump, onboarding), with the per-package deltas stated in the PR.

AC: 00 and 08 agree; the two sanctioned refresh shapes are no longer forbidden.

From PR #2822 round 9 finding 2 (carried under the process-residue default, reviewer-sanctioned).
<!-- SECTION:DESCRIPTION:END -->
