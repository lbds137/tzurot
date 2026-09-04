---
id: TASK-48
title: LLM config type consolidation
status: To Do
assignee: []
created_date: '2026-06-27 00:00'
updated_date: '2026-09-04 20:07'
labels:
  - 'area:voice'
  - 'area:common-types'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

LLM config type consolidation — `Resolved`/`Mapped` + `Database`/`Raw` near-duplicates

**Why:** `ResolvedLlmConfig` (`common-types/types/configResolution.ts`) ≈ `MappedLlmConfig` (`common-types/services/LlmConfigMapper.ts`) minus `{ provider }` (was also `kind` until the legacy-column retirement dropped it) — both independently `extends ConvertedLlmParams` and re-list the same 7 DB fields (model + memory/context/message fields), so the kinship is implicit and the two can silently drift. Separately, `DatabaseLlmConfig` (`identity/PersonalityValidator.ts`) and `RawLlmConfigFromDb` (`LlmConfigMapper.ts`) are two "raw DB-ish" shapes that may overlap. **Fix shape**: express `ResolvedLlmConfig` as `Omit<MappedLlmConfig, 'provider'>` (or a shared base) so the relationship is explicit + can't drift, and audit whether `DatabaseLlmConfig`/`RawLlmConfigFromDb` can unify. The field difference IS intentional (provider stays on the personality seed) — this is cosmetic/cognitive debt, not behavioral, so it deserves its OWN diff with its own review (touches load-bearing mapper/resolver types). Note: the breadth (Mapped/Resolved/Loaded × Llm/Tts/Vision/Stt) is a deliberate per-axis-concrete choice, NOT the target here — only the within-axis near-duplication is. **Promote when**: opportunistically when next touching the mapper/resolver type stack, or as a deliberate types pass. Surfaced 2026-06-27 (vision-config epic — user flagged Mapped/Loaded layering during Phase 1).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:07
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-95 (Idea Config service and config schema refactor family); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-48 finds it.
---
<!-- COMMENTS:END -->
