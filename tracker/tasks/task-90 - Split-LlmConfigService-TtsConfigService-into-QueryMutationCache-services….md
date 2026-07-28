---
id: TASK-90
title: Split LlmConfigService + TtsConfigService into query/mutation/cache services
status: To Do
assignee: []
created_date: '2026-05-03 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:voice'
  - 'area:api-gateway'
  - 'size:L'
dependencies: []
priority: low
ordinal: 90000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Split `LlmConfigService` + `TtsConfigService` into Query/Mutation/Cache services (cross-cutting)

**Why:** Both services hover at ~600+ raw LOC with mixed responsibilities. Currently passes lint via skip-blanks/skip-comments. Council recommended pre-splitting; user chose mirror-as-single-file for now and split BOTH later when burden becomes real. **Fix shape**: when either crosses the lint threshold, split BOTH into `*QueryService.ts` + `*MutationService.ts` (cache wiring stays in mutation). Mirror split for both LLM and TTS in same PR for symmetry. **Promote when**: ESLint `max-lines` flags either service, OR new feature requires expansion that pushes over 400 content-lines. Surfaced 2026-05-03. Deferred 2026-05-07.
<!-- SECTION:DESCRIPTION:END -->
