---
id: TASK-304
title: 'Sync-config completeness test: harden the schemaTableNames parser'
status: To Do
assignee: []
created_date: '2026-07-20 00:00'
updated_date: '2026-09-04 19:36'
labels:
  - 'area:db'
  - 'origin:review'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 304000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-20 (#1733 review observation) — the sync-config completeness test's schema parser (`schemaTableNames` in `syncTables.test.ts`) assumes every model's closing brace is unindented on its own line (documented in-code). A `prisma format` or schema-wide style reformat could change that and make the parser silently UNDER-count tables — the test would stop guarding (fail-safe-ish: no runtime bug, but a false sense of completeness). **Fix shape**: parse via Prisma DMMF, or add a sanity assert that the parsed table count equals the `model` keyword count. **Promote when**: a schema reformat lands, or the completeness test ever needs to survive a brace-style change.

**Why:** Documented assumption; the fix trades the fast pure-regex test for DMMF robustness — only worth it if the assumption actually breaks.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `schemaTableNames()` in `syncTables.test.ts` is still a regex over `schema.prisma` assuming unindented closing braces, with the same documented fragility comment — no DMMF-based rewrite or brace-count sanity assertion has been added. Evidence: `sed -n '1,50p' services/api-gateway/src/services/sync/config/syncTables.test.ts` → `matchAll(/\bmodel\s+(\w+)\s*\{([\s\S]*?)\n\}/g)`, unchanged.
---
<!-- COMMENTS:END -->
