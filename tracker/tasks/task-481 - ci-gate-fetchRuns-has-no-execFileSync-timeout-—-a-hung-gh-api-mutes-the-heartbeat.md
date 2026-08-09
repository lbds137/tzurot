---
id: TASK-481
title: >-
  ci-gate fetchRuns has no execFileSync timeout — a hung gh api mutes the
  heartbeat
status: To Do
assignee: []
created_date: '2026-08-09 11:26'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 481000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: fetchRuns in packages/tooling/src/gh/ci-gate.ts passes no timeout to execFileSync, so a HUNG (not failing) gh api blocks the synchronous poll loop and the 10-min heartbeat cannot fire — the "broken gate must never look like a slow one" promise fails for the hang shape. Bounded by the Monitor's 30-min kill, so degradation is the documented no-sentinel row, but inconsistent with fetchPrHeadSha (#1995, 15s) and ghApi (#2018), which both added timeouts citing exactly this rationale.
Fix shape: add a timeout to fetchRuns' execFileSync consistent with its siblings; on expiry report it through the existing gh-api-failure reporting path (first failure immediately, every 10th after). Canary: a test that fakes a timeout-shaped throw and asserts the failure line prints.
Surfaced by post-merge audit of #1992.
<!-- SECTION:DESCRIPTION:END -->
