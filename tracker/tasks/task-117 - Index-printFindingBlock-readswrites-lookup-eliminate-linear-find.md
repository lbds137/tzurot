---
id: TASK-117
title: Index printFindingBlock reads/writes lookup (eliminate linear .find())
status: Done
assignee: []
created_date: '2026-05-21 00:00'
updated_date: '2026-07-30 00:57'
labels:
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: low
ordinal: 117000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Index `printFindingBlock` reads/writes lookup (eliminate linear `.find()`)

**Why:** `packages/tooling/src/dev/schema-audit-report.ts` `printFindingBlock` does `reads.find(c => c.model === f.model && c.field === f.field)` and the same for writes — O(N) per finding, called once per finding render. `generateFindings` already builds `Map`s keyed by `${model}.${field}`; could pass them down or build them once at the top of `printMarkdownReport`. **Fix shape**: thread the `Map<string, ReadModeClassification>` and `Map<string, WriteSiteClassification>` from `generateFindings` into `printMarkdownReport`, replace `.find()` with `.get(key)`. ~15 LOC delta. **Why deferred**: with 4 findings × <100 optional fields, the cost is invisible. Co-fix candidate with the `ts-morph` Project-sharing entry above. **Promote when**: bundled with the Project-sharing fix, OR if findings volume reaches the hundreds (unlikely). Surfaced 2026-05-21 by PR #1076 round-6 claude-bot review. Deferred 2026-05-21.
<!-- SECTION:DESCRIPTION:END -->
