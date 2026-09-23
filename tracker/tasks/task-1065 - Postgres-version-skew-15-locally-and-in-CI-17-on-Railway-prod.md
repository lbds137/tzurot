---
id: TASK-1065
title: 'Postgres version skew: 15 locally and in CI, 17 on Railway prod'
status: To Do
assignee: []
created_date: '2026-09-23 23:58'
labels:
  - 'area:db'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1059000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the local tzurot-postgres container and the CI service (.github/workflows/ci.yml, the postgres service image, ~line 471 at filing) run PG 15, while Railway runs PG 17. Integration and migration behavior is exercised on a different major than prod (planner, SQL features, pgvector build). Found by a sibling env-cleanup session 2026-09-23; verify the exact image tags before changing.
Fix shape: move CI and the local container to the prod major (17, with a pgvector image that matches), rerun the integration tier in CI, and note the local upgrade steps (dump/restore of the dev volume) in the Steam Deck docs.
Acceptance: CI and local report the same Postgres major as prod (SELECT version()), integration tier green.
<!-- SECTION:DESCRIPTION:END -->
