---
id: TASK-1169
title: >-
  Surface inventory: follow spreads inside literals passed directly as call
  arguments
status: To Do
assignee: []
created_date: '2026-10-04 20:47'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1161000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the discord.js surface inventory (packages/tooling/src/surface/analyzer.ts collectOptionKeys, ObjectLiteral branch -> literalKeys) records only the literal's own keys, so `reply({ content, ...rest })` silently drops the keys `rest` carries. The return path (returnedLiteralKeys) already follows such spreads, resolving a literal-initialized local or recording the `*` marker, so the two paths disagree and the direct one is the silent-gap class PR #2571 closed elsewhere.

What: measure first (count direct-argument literals with a SpreadAssignment in bot-client), then route the ObjectLiteral branch through returnedLiteralKeys. This changes the existing analyzer.test.ts fixture assertion that spread keys are not key sites, so it is a spec change: state the new semantics in the PR.

Acceptance: a direct-literal spread of a literal-initialized local records that local's keys, an unresolvable spread records `*`, snapshot regenerated, doc-109 TR-9.1 counts updated.
<!-- SECTION:DESCRIPTION:END -->
