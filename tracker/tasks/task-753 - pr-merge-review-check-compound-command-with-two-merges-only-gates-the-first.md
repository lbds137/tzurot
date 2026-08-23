---
id: TASK-753
title: 'pr-merge-review-check: compound command with two merges only gates the first'
status: To Do
assignee: []
created_date: '2026-08-23 20:29'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 753000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: observed 2026-08-23 - a single Bash call chaining gh pr merge 2197 && gh pr merge 2198 fired the gate for 2197 only; 2198 merged without its per-review ack cycle. The review HAD been read in full (zero findings), so no harm this time, but the gate is attention-independent by design and a compound command bypasses it silently.
Fix shape: the hook (.claude/hooks/pr-merge-review-check.sh) should detect MULTIPLE gh pr merge invocations in one command and either block the compound outright (one merge per command) or gate each PR number found. Add a probe case per the hook-probe registry.
Acceptance: a compound two-merge command is blocked or both PRs are gated; probe covers it.
<!-- SECTION:DESCRIPTION:END -->
