---
id: TASK-28
title: 'LlmConfigService.ts sits at the max-lines ceiling'
status: To Do
assignee: []
created_date: '2026-07-04 00:00'
labels:
  - 'origin:review'
dependencies: []
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`LlmConfigService.ts` sits at the max-lines ceiling — The file is at the eslint `max-lines: 400` limit (counted, after skipBlankLines/skipComments; ~722 raw), so any new logic forces an extraction — as #1483 did for the reasoning check. **Fix shape**: split a cohesive chunk into its own module — the read/format helpers (`formatConfigSummary`/`formatConfigDetail`/`enrichWithModelContext`) or the name-collision/clone logic are natural seams. **Promote when**: the next feature touching LlmConfigService needs to add lines, or a max-lines lint failure recurs. Surfaced 2026-07-04 (#1483 review, non-blocking).

**Why:** Every future change to this service pays an extraction tax; a proactive split removes the friction.
<!-- SECTION:DESCRIPTION:END -->
