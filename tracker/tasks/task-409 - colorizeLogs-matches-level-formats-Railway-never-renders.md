---
id: TASK-409
title: colorizeLogs matches level formats Railway never renders
status: To Do
assignee: []
created_date: '2026-08-03 17:12'
updated_date: '2026-08-03 17:12'
labels:
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: low
ordinal: 409000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/tooling/src/deployment/logs.ts colorizeLogs greps for "level":"error" (JSON) and level=error (logfmt), but the Railway CLI renders levels as [ERROR]/[WARN]/[INFO] tags - so no real CLI line is ever colorized. Same wrong-format-assumption class as TASK-404 (fixed in PR #1918), but purely cosmetic: nothing is dropped, output is just uncolored. Surfaced by the TASK-404 diagnosis probe.
Fix shape: match the [LEVEL] tag form (primary), keep the JSON/logfmt forms for --json mode; a fixture test against the real rendered shape like the TASK-404 tests.
Acceptance: an [ERROR] line from real railway logs output renders red in the dig; test pins it.
<!-- SECTION:DESCRIPTION:END -->
