---
id: TASK-207
title: >-
  Preset model field: autocomplete from OpenRouterModelCache instead of freeform
  text
status: Done
assignee: []
created_date: '2026-07-05 00:00'
updated_date: '2026-08-05 04:52'
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

**Grounding 2026-07-29 (drain freshness-check): NOT implementable as written.** The model field is a MODAL text input (buildPresetSeedModal → presetSeedFields), and Discord has no autocomplete for modal inputs — autocomplete exists only on slash-command options. Re-shape options, all needing an owner UX call: (a) add an optional autocompletable `model` slash option on /preset create that prefills the modal; (b) replace the freeform field with a select-menu model picker (like /models browse) — bigger redesign; (c) keep the modal but improve the validation-failure retry with closest-match suggestions from OpenRouterModelCache. Owner picks the shape before any build.

OWNER CALL 2026-08-04: shape (a) — add an optional autocompletable model slash option on /preset create that prefills the modal. Smallest change, keeps the current flow. Now agent-runnable, still size:S.
<!-- SECTION:DESCRIPTION:END -->
