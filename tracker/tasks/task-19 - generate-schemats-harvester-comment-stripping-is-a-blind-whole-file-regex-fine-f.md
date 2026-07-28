---
id: TASK-19
title: generate-schema.ts comment-stripping is a blind whole-file regex
status: To Do
assignee: []
created_date: '2026-07-10 00:00'
updated_date: '2026-07-28 10:46'
labels:
  - 'area:testing'
  - 'size:S'
dependencies: []
priority: low
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-10 — `generate-schema.ts` harvester comment-stripping is a blind whole-file regex; fine for short DDL, but the new plpgsql-function harvester processes full bodies — a future function whose string literal contains `--` or `/*` (a URL, example text) would be silently corrupted/dropped from the PGLite schema. **Fix shape**: dollar-quote-aware stripping (skip $$…$$ spans) or a harvest-count parity assertion vs live migrations. **Promote when**: next time a plpgsql function is added/edited, or the next generate-schema touch.

**Why:** Silent trigger loss in PGLite = component tests quietly stop exercising prod behavior (reviewer flag on #1579).
<!-- SECTION:DESCRIPTION:END -->
