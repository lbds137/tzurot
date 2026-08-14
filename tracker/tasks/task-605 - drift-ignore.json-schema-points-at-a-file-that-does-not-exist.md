---
id: TASK-605
title: drift-ignore.json $schema points at a file that does not exist
status: Done
assignee: []
created_date: '2026-08-14 12:03'
updated_date: '2026-08-14 16:37'
labels:
  - 'area:db'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 605000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: `prisma/drift-ignore.json` opens with "$schema": "./drift-ignore.schema.json", and `ls prisma/drift-ignore.schema.json` reports no such file (verified 2026-08-14, surfaced by the PR 2099 review). Editors that honour $schema get a broken reference, so the file gets no completion or validation despite advertising both.

The file now feeds check-migration-safety.ts at load time as well as the drift sanitizer, so a schema has more value than when the reference was written: it would catch a malformed protectedIndexes entry in the editor rather than at tool-run time.

Fix shape: either write the JSON Schema the reference promises (protectedIndexes entries carry name, table, type, description, recreateSQL, dropPattern, createPattern; ignorePatterns entries carry pattern, reason, action) or drop the $schema line. Writing it is preferred — deleting the line silently abandons the intent rather than recording it.

Acceptance: the $schema reference resolves, or it is gone; if written, an entry missing dropPattern is flagged by a schema-aware editor.
<!-- SECTION:DESCRIPTION:END -->
