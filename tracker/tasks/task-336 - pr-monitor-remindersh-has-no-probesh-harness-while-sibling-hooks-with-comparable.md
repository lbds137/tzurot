---
id: TASK-336
title: pr-monitor-reminder.sh lacks a probe harness
status: To Do
assignee: []
created_date: '2026-07-27 00:00'
updated_date: '2026-07-28 10:53'
labels:
  - 'origin:review'
  - 'area:process'
  - 'size:S'
dependencies: []
priority: low
ordinal: 336000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-27 (reviews on the assignee-policy PRs, twice) — **`pr-monitor-reminder.sh` has no `.probe.sh` harness** while sibling hooks with comparable pattern-matching fragility (`cwd-drift-guard`, `develop-code-commit-guard`, `promise-ledger-check`) all ship one; the hook now carries case-based classification (bot-vs-human login shape, PR-number extraction, tag-push filters) that a probe would pin. **Fix shape**: colocated `.probe.sh` exercising synthetic PostToolUse payloads (gh pr create with/without stdout, tag push, bot author, colon-shaped garbage). **Promote when**: next edit to this hook, or a probe-coverage standardization pass.

**Why:** Reviewer asked twice across consecutive PRs; the sibling convention makes it a real gap, not a style wish.
<!-- SECTION:DESCRIPTION:END -->
