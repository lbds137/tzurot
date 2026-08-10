---
id: TASK-510
title: Detect repo-escaping fs reads in tooling tests mechanically
status: To Do
assignee: []
created_date: '2026-08-10 20:43'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 510000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: turbo-inputs-coverage.test.ts guards only the roots someone remembered to wire into REQUIRED_ROOTS. The PR 2054 enumeration missed 3 live-sweep test files on the first pass (handler-paths, coverageTopology, protectedIndexRegistries - caught by review round 3), proving the manual-audit step does not scale to guard number 10+. A new tooling test that reads outside the package next month silently escapes the cache-inputs contract again.
Fix shape (reviewer sketch, PR 2054 round 3): a lint- or AST-based check that flags any readFileSync/readFile/existsSync/readdirSync/findFiles call in a *.test.ts under packages/tooling/src whose resolved path climbs outside the package (e.g. a ../../../.. or repoRoot resolution) and is not covered by a REQUIRED_ROOTS entry / turbo.json glob. Could live inside turbo-inputs-coverage.test.ts as a source-scanning describe block.
Acceptance: adding a tooling test that reads a new outside-package tree fails CI until the tree is declared in turbo.json + REQUIRED_ROOTS.
<!-- SECTION:DESCRIPTION:END -->
