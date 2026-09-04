---
id: TASK-90
title: Split LlmConfigService + TtsConfigService into query/mutation/cache services
status: To Do
assignee: []
created_date: '2026-05-03 00:00'
updated_date: '2026-09-04 20:07'
labels:
  - 'area:voice'
  - 'area:api-gateway'
  - 'size:L'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 90000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Split `LlmConfigService` + `TtsConfigService` into Query/Mutation/Cache services (cross-cutting)

**Why:** Both services hover at ~600+ raw LOC with mixed responsibilities. Currently passes lint via skip-blanks/skip-comments. Council recommended pre-splitting; user chose mirror-as-single-file for now and split BOTH later when burden becomes real. **Fix shape**: when either crosses the lint threshold, split BOTH into `*QueryService.ts` + `*MutationService.ts` (cache wiring stays in mutation). Mirror split for both LLM and TTS in same PR for symmetry. **Promote when**: ESLint `max-lines` flags either service, OR new feature requires expansion that pushes over 400 content-lines. Surfaced 2026-05-03. Deferred 2026-05-07.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:07
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-95 (Idea Config service and config schema refactor family); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-90 finds it.
---
<!-- COMMENTS:END -->
