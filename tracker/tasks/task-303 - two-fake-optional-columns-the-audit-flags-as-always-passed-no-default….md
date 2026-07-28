---
id: TASK-303
title: Two fake-optional columns flagged always-passed-no-default
status: To Do
assignee: []
created_date: '2026-07-23 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'area:db'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 303000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-23 (retention 1c, `dev:schema-audit` run) — two fake-optional columns the audit flags as always-passed-no-default: `LlmDiagnosticLog.userId` (3/3 write sites pass a value) and `ExportJob.downloadToken` (4/4). The `?` is unused — every writer supplies a value and no `@default` justifies skipping it. **Fix shape**: verify each call site, then `ALTER COLUMN … SET NOT NULL` + drop the `?` in `schema.prisma` (one migration per column, or both together). Pre-existing; unrelated to retention, deferred because it needs a migration + call-site sweep (risky breadth for a 1c rider). **Promote when**: next migration on either table, or a schema-hardening pass.

**Why:** Fake-optional columns are the exact bug-class `schema-audit` exists to catch; tracking them durably beats an ad-hoc tool run nobody re-runs.
<!-- SECTION:DESCRIPTION:END -->
