---
id: TASK-1200
title: >-
  db:check-safety strips only whole-line -- comments - a /* */ block comment can
  smuggle a WHERE clause past the createPattern
status: To Do
assignee: []
created_date: '2026-10-10 00:40'
labels:
  - 'area:tooling'
  - 'area:db'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1189000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
2026-10-10, from the #2597 round-4 review (finding 2): checkMigrationFile strips only lines STARTING with --, so trailing -- comments and /* */ blocks stay in the statement text. A /* WHERE chunk_group_id IS NOT NULL */ block inside a non-partial recreate satisfies the chunk-group createPattern - a false-negative path the WHY doc now documents as accepted (see the block-comment gap note). Fix shape: strip /* */ blocks (regex /\/\*[\s\S]*?\*\//g on the comment-stripped content, before the statement split) plus trailing -- comments, or leave documented if creative-SQL risk stays acceptable. Rider: the WHY paragraph ends with the old sentence 'False positives in either direction are possible...' which the newer fails-closed language partially contradicts - trim it in the same edit.
<!-- SECTION:DESCRIPTION:END -->
