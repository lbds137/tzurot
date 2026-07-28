---
id: TASK-207
title: >-
  Preset model field: autocomplete from OpenRouterModelCache instead of freeform
  text
status: To Do
assignee: []
created_date: '2026-07-05 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 207000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Preset model field: autocomplete from OpenRouterModelCache instead of freeform text

**Why:** Server-side validation + context-window caps shipped (config-cascade-design Phase 1b); the UX half of the old note remains — preset create/edit model input is freeform; autocomplete from the model cache (like /models browse) would kill typos at the source. Ingested 2026-07-05.
<!-- SECTION:DESCRIPTION:END -->
