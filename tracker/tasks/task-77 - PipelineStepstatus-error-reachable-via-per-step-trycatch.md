---
id: TASK-77
title: 'PipelineStep.status: ''error'' reachable via per-step try/catch'
status: To Do
assignee: []
created_date: '2026-04-25 00:00'
updated_date: '2026-07-28 10:47'
labels:
  - 'area:ai-worker'
  - 'size:S'
dependencies: []
priority: low
ordinal: 77000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`PipelineStep.status: 'error'` reachable via per-step try/catch

**Why:** Schema declares `'success' | 'skipped' | 'error'` and `extendedViews.ts` renders the ❌ icon for it, but `DiagnosticCollector.recordPostProcessing()` currently only emits `success` / `skipped` because today's post-processing transforms (`duplicate_removal`, `thinking_extraction`, `artifact_strip`, `placeholder_replacement`) are simple string ops that don't realistically throw. If a step did throw today, the whole `recordPostProcessing` call dies and `pipelineSteps` is never set — failure is invisible to the Pipeline Health view rather than surfaced in it. **Fix shape**: refactor the `recordPostProcessing` array-build so each step is wrapped in its own try/catch returning a `PipelineStep` (rather than the positional ternary today); on catch emit `{ name, status: 'error', reason: err.message }`. **Promote when**: pipeline grows steps that do real I/O (vector lookups, external API calls) — i.e. when a step _can_ legitimately fail. Surfaced 2026-04-25 by claude-bot on PR #899. Deferred 2026-04-27.
<!-- SECTION:DESCRIPTION:END -->
