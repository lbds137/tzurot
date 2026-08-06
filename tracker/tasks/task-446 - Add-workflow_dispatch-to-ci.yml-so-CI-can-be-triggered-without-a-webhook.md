---
id: TASK-446
title: Add workflow_dispatch to ci.yml so CI can be triggered without a webhook
status: To Do
assignee: []
created_date: '2026-08-06 22:56'
labels:
  - 'area:ci'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 446000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced 2026-08-06 during a GitHub Actions major outage: webhook delivery was throttled to ~15%, so pushes stopped triggering workflow runs and two open PRs sat unmergeable for hours with no way to start CI by hand.

Probed and confirmed, not inferred: gh workflow run CI --ref <branch> returns HTTP 422 "Workflow does not have workflow_dispatch trigger". ci.yml is push-only by design (its own comment: "No pull_request trigger = no duplicate runs"), which is the right call for avoiding duplicate runs but leaves CI with NO trigger that bypasses the webhook path. When webhooks degrade, there is no escape hatch.

Fix shape: add "workflow_dispatch:" to the on: block in .github/workflows/ci.yml. It adds no automatic runs, so it costs nothing in normal operation, and it turns a degraded-webhook incident into a one-command recovery.

Acceptance: gh workflow run CI --ref <branch> dispatches a run successfully.

Process note: this needs a PR, not a direct develop commit — 00-critical doc-commit exception puts .github/ CI config in the still-requires-a-PR column. It is a normal develop-targeting PR though, NOT the main-cut ceremony that claude-code-review.yml and claude.yml require (guard:workflow-sync covers only those two).
<!-- SECTION:DESCRIPTION:END -->
