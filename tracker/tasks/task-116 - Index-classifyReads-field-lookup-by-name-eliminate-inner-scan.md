---
id: TASK-116
title: Index classifyReads field lookup by name (eliminate inner-scan)
status: Done
assignee: []
created_date: '2026-05-21 00:00'
updated_date: '2026-07-30 00:57'
labels:
  - 'area:tooling'
  - 'area:db'
  - 'size:S'
dependencies: []
priority: low
ordinal: 116000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Index `classifyReads` field lookup by name (eliminate inner-scan)

**Why:** `packages/tooling/src/dev/schema-audit-reads.ts` `classifyReads()` walks every `PropertyAccessExpression` node in the source tree and runs a linear scan over `optionalFields` per access. The companion `analyzeWrites` already pre-groups fields by accessor name — `classifyReads` can mirror that. **Fix shape**: build a `Map<fieldName, PrismaField[]>` outside the file loop, then `fieldsByName.get(fieldName) ?? []` instead of the inner `for (const field of optionalFields)`. ~10 LOC delta. **Why deferred**: tool is one-shot / quarterly; complexity is `O(propAccesses × optionalFields)` ≈ 50k × 500 = 25M comparisons on the current codebase — measurable but tolerable. Promote when audit runtime becomes a complaint, OR when wiring into a recurring step that runs more than monthly. Surfaced 2026-05-21 by PR #1076 round-5 claude-bot review. Deferred 2026-05-21.
<!-- SECTION:DESCRIPTION:END -->
