---
id: TASK-489
title: 'Guard: package build scripts keep the clean-first shape'
status: To Do
assignee: []
created_date: '2026-08-09 16:43'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 489000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: all package builds are rm -rf dist tsconfig.tsbuildinfo then tsc (clean-first, the turbo cache-poisoning fix); a NEW package added without that shape silently reintroduces the stale-dist class. The original follow-ups.md row for this was lost in the tracker migration; restored 2026-08-09 during the memory sweep.
What: a guard (guard:build-scripts or a structure.test assertion) asserting every workspace package build script starts with the clean-first purge.
Acceptance: guard red when a package build script lacks the clean-first prefix; wired into pnpm quality or CI lint.
<!-- SECTION:DESCRIPTION:END -->
