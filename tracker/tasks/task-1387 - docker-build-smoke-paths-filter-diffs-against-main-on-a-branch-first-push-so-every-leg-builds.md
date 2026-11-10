---
id: TASK-1387
title: >-
  docker-build-smoke paths-filter diffs against main on a branch first push, so
  every leg builds
status: To Do
assignee: []
created_date: '2026-11-10T14:23:00Z'
labels:
  - area:ci
  - size:S
  - state:ready
dependencies: []
priority: high
ordinal: 1370000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the docker-build-smoke paths-filter step (ci.yml:726, also the voice-engine filter at :633) sets no base. On a branch first push (no before SHA) dorny/paths-filter falls back to the default branch, main, which is ~150 commits behind develop; job log 129692165174 shows 234 changed files and every leg true. Build image ran in 16 of 20 recent runs, against the comment at ci.yml:683-686 that most PRs skip every leg.
What: set base: develop on both filter steps (decide main-push behaviour for release merges).
Saving: ~525 runner-s per affected run (Fable perf review 2026-11-10, item P2).
Acceptance: a first push of a branch touching no Dockerfile or build-input config skips every docker leg.
<!-- SECTION:DESCRIPTION:END -->
