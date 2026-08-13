---
id: TASK-557
title: >-
  rawOptionValue misses cac-accepted camelCase spellings and fails open on
  repeated --exclude
status: Done
assignee: []
created_date: '2026-08-12 22:32'
updated_date: '2026-08-13 01:35'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 557000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #2060 regression, probe-confirmed. cac binds --jobId/--requestId (camelCase) to the same key as --job-id/--request-id, but rawOptionValue matches only the literal kebab token - so a camelCase incident dig silently runs UNFILTERED while looking successful (the exact silent-failure shape the PR was written to kill; strict regression for --request-id). Worse: repeated --exclude on retention:purge now returns the FIRST occurrence where the old code failed closed by crashing - a silently narrowed protection list on an irreversible purge (cli-args.ts:30-42 pins first-occurrence semantics; retention.ts:177 consumes it).

Fix shape: rawOptionValue also matches the camelCase alias (or hard-errors when cac parsed a value the raw scan did not find); throw UsageError when a raw-scanned flag appears more than once.

Acceptance: camelCase spellings either filter correctly or error; repeated --exclude errors instead of proceeding. Source: 2026-08-12 review (tooling reviewer M1/M2, M1 confirmed by live cac probe).
<!-- SECTION:DESCRIPTION:END -->
