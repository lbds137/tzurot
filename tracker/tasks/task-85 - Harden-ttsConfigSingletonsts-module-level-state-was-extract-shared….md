---
id: TASK-85
title: Harden ttsConfigSingletons module-level state
status: To Do
assignee: []
created_date: '2026-05-04 00:00'
updated_date: '2026-07-28 10:47'
labels:
  - 'area:voice'
  - 'size:M'
dependencies: []
priority: low
ordinal: 85000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Harden `ttsConfigSingletons.ts` module-level state (was: extract shared `SingletonFlagResolver`)

**Why:** Module-level `let pendingResolutions` for cross-call state; the type system doesn't enforce prepare→finalize sequencing — silently no-ops on stale state if order flips. Re-scoped 2026-07-05: the LLM twin (`llmConfigSingletons.ts`) was deleted by the legacy-column retirement (#1499), so the shared-class extraction is moot — only the TTS file remains, and it dissolves entirely when the TTS mirror columns (`tts_configs.isDefault`/`isFreeDefault`) get their own retirement. **Promote when**: the TTS legacy-column retirement is planned (fold the deletion in), OR the sequencing fragility actually misfires. Surfaced 2026-05-04 PR #968.
<!-- SECTION:DESCRIPTION:END -->
