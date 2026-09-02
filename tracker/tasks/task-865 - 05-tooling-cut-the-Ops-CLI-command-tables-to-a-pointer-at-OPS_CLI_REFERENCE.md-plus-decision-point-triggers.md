---
id: TASK-865
title: >-
  05-tooling: cut the Ops CLI command tables to a pointer at
  OPS_CLI_REFERENCE.md plus decision-point triggers
status: To Do
assignee: []
created_date: '2026-09-02 13:39'
labels:
  - 'area:rules'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 865000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 05-tooling.md is the largest always-loaded rules file, and its Ops CLI subsections (db, gh, deploy, xray, mutation, secrets, advisories, audits, CPD, guards, backlog) duplicate docs/reference/tooling/OPS_CLI_REFERENCE.md, which guard:ops-doc keeps complete. Owner decision 2026-09-02: take the lever.

Fix shape: rules PR (review-gated). Keep every decision-point sentence (when to reach for a command) and the PR Monitoring section intact; replace the command tables with one pointer. Apply the doc-audit skill section 3b four-question cut test; put before/after bytes in the PR body; ratchet DOWN with lines:update-baseline --surface rules.

Acceptance: guard:ops-doc, guard:claude-content-refs, guard:monitor-command and lines:check green; every command formerly in the tables resolves in OPS_CLI_REFERENCE.md; the rules byte count drops and the baseline is ratcheted down in the same commit.
<!-- SECTION:DESCRIPTION:END -->
