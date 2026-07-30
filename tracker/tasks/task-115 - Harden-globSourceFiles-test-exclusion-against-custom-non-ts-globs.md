---
id: TASK-115
title: Harden globSourceFiles test-exclusion against custom non-*.ts globs
status: Done
assignee: []
created_date: '2026-05-21 00:00'
updated_date: '2026-07-30 00:57'
labels:
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: low
ordinal: 115000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Harden `globSourceFiles` test-exclusion against custom non-`*.ts` globs

**Why:** `packages/tooling/src/dev/schema-audit.ts` `globSourceFiles()` builds the test exclusion via `glob.replace(/\*\.ts$/, '*.test.ts')`. If a caller passes a custom `sourceGlobs` ending in `*.tsx` or `*.ts?(x)`, the replace silently no-ops and the "exclusion" pattern becomes the original glob — excluding ALL files in the custom path rather than just test variants. The default `['services/**/*.ts', 'packages/**/*.ts']` is fine; the edge case only surfaces when callers override. **Fix shape**: guard the exclusion generation behind `glob.endsWith('*.ts')`, OR generalize the test exclusion to a separate explicit pattern that doesn't depend on the input glob's suffix. ~5 LOC. **Why deferred**: no caller currently overrides `sourceGlobs`; tests use defaults. Promote when adding TSX support or the first custom-glob caller. Surfaced 2026-05-21 by PR #1076 round-3 claude-bot review. Deferred 2026-05-21.
<!-- SECTION:DESCRIPTION:END -->
