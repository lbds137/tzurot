---
id: TASK-55
title: 'Evaluate adding component tests to the pre-push hook'
status: To Do
assignee: []
created_date: '2026-06-25 00:00'
labels:
  - 'area:redis'
  - 'origin:review'
dependencies: []
ordinal: 55000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Evaluate adding component tests to the pre-push hook

**Why:** Phase-4 PR1 (#1346) made `pnpm test:component` require a running Redis container. Pre-push does NOT currently run component tests, so there's no impact today — but once the contract tier is populated (PR3+), running component+contract in pre-push could catch seam regressions before CI. Trade-off: pre-push already flakes under memory pressure on the Steam Deck (a real-Redis dependency + heavier run would worsen it). **Fix shape**: weigh a focused/changed-package component run in pre-push vs. leaving it CI-only. **Promote when**: the contract tier is established (PR3+ landed) AND pre-push latency/flake is acceptable. Surfaced 2026-06-25 (PR #1346 claude-review).
<!-- SECTION:DESCRIPTION:END -->
