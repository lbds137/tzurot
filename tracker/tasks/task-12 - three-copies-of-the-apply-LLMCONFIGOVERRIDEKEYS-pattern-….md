---
id: TASK-12
title: 'three copies of the apply-LLM_CONFIG_OVERRIDE_KEYS pattern —…'
status: To Do
assignee: []
created_date: '2026-07-12 00:00'
labels:
  - 'area:api-gateway'
  - 'area:ai-worker'
  - 'area:common-types'
  - 'area:config-resolver'
dependencies: []
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-12 — three copies of the apply-`LLM_CONFIG_OVERRIDE_KEYS` pattern — `LlmConfigResolver.mergeWithPersonality`/`extractFromPersonality` (config-resolver), `stampResolvedConfig.applyResolvedConfig` (api-gateway), and `quotaFallback.applyConfigToPersonality` (ai-worker) are structurally identical key-copy loops (reviewer-verified on #1600). Three copies of the same decision can drift — a fourth key-semantics change (e.g. a nested-merge field) would need three edits. **Fix shape**: one shared helper in common-types (likely next to `LLM_CONFIG_OVERRIDE_KEYS` itself in `llmAdvancedParams.ts`), three call sites converted. **Promote when**: next touch of any of the three, or when a new override key with non-trivial merge semantics lands.

**Why:** Reuse-scout consolidation; the copies must not disagree about the same question.
<!-- SECTION:DESCRIPTION:END -->
