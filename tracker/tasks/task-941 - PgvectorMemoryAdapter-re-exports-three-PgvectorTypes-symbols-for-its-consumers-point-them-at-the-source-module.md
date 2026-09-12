---
id: TASK-941
title: >-
  PgvectorMemoryAdapter re-exports three PgvectorTypes symbols for its
  consumers; point them at the source module
status: Done
assignee: []
created_date: '2026-09-12 12:39'
updated_date: '2026-09-12 15:20'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 939000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PgvectorMemoryAdapter.ts re-exports MemoryQueryOptions, MemoryMetadata and MemoryMetadataSchema from PgvectorTypes.js for about ten consumers. PR 2402 made the re-export type-correct when it enabled consistent-type-exports, but 02-code-standards bans wrapper re-exports: import from source modules, never through another module.
Fix shape: grep every import of those three names from PgvectorMemoryAdapter.js, repoint each at PgvectorTypes.js (type imports for the two interfaces, a value import for the schema), delete the re-export, and confirm knip reports no new unused export.
Acceptance: no module imports those three names from PgvectorMemoryAdapter.js; the ai-worker suite, lint, typecheck and knip stay green.
<!-- SECTION:DESCRIPTION:END -->
