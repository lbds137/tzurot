---
id: TASK-120
title: Extract buildQueryString from generated client files (route-codegen)
status: Done
assignee: []
created_date: '2026-05-24 00:00'
updated_date: '2026-07-30 14:27'
labels:
  - 'area:ai-worker'
  - 'area:common-types'
  - 'area:tooling'
  - 'area:ci'
  - 'size:S'
dependencies: []
priority: low
ordinal: 120000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Extract `buildQueryString` from generated client files (route-codegen)

**Why:** All three generated client classes inline the same 6-line `buildQueryString` helper. Council finding from PR #1090 (claude-bot review 2, 2026-05-24): valid concern that the duplication is invisible to readers because generated files are never hand-edited, but the helper could be exported from `clients/transport.ts` and imported via `'../../index.js'` (already present in every generated file's import block) to eliminate the repetition. **Why deferred**: trade-off is marginal — the codegen output is excluded from CPD, knip, and codecov, and keeping generated files self-contained-ish has some readability value. **Fix shape**: move the function body to `packages/common-types/src/clients/transport.ts`, export it, then drop `buildQueryHelper()` from `packages/tooling/src/codegen/client-builder.ts` and add `buildQueryString` to the import-symbols list emitted by `buildImports`. Regenerate. **Promote when**: a 4th generated client (e.g. PR-1.5's `mounts.ts` server-side or a future ai-worker client) makes the inlining feel embarrassing, OR opportunistically when next touching `client-builder.ts`. Surfaced 2026-05-24 by PR #1090 round 1 claude-bot review. Deferred 2026-05-24.
<!-- SECTION:DESCRIPTION:END -->
