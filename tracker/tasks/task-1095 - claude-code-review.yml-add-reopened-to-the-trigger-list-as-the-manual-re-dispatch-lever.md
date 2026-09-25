---
id: TASK-1095
title: >-
  claude-code-review.yml: add reopened to the trigger list as the manual
  re-dispatch lever
status: To Do
assignee: []
created_date: '2026-09-25 01:35'
labels:
  - 'area:ci'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1088000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-777 recorded that a synchronize event sometimes dispatches NO Claude Code Review run (PR 2232, two consecutive misses) and that close/reopen does not re-trigger because the workflow listens only for [opened, synchronize]. The detection half shipped with the ci-gate CI_GATE_REVIEW_MISSING sentinel; this is the remedy half (fix shape b on TASK-777), so the sentinel points at something the driver can do.
Fix shape: add `reopened` to `on.pull_request.types` in `.github/workflows/claude-code-review.yml`. This file is guard:workflow-sync gated, so it lands via a MAIN-CUT branch targeting main (see /tzurot-git-workflow, Claude workflow changes target main), then `pnpm ops release:finalize`. Check whether the review-round counter in reviewRounds.ts (1:1 push-to-run assumption, documented there) needs its comment updated: a reopen adds a run without a push.
Acceptance: closing and reopening a PR creates a new Claude Code Review run for its head SHA (read from the SHA-pinned actions/runs query), and 05-tooling.md CI_GATE_REVIEW_MISSING row names close/reopen as the lever.
<!-- SECTION:DESCRIPTION:END -->
