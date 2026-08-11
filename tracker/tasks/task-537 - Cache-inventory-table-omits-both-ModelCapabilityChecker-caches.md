---
id: TASK-537
title: Cache inventory table omits both ModelCapabilityChecker caches
status: To Do
assignee: []
created_date: '2026-08-11 22:55'
labels:
  - 'area:docs'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 537000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the cache inventory in .claude/rules/03-database.md is an always-loaded surface whose own text says a wrong row is "a wrong premise in every session that reads it". Two caches in services/ai-worker/src/services/ModelCapabilityChecker.ts are absent from it: capabilityCache (5 min, AI_DEFAULTS.MODEL_CAPABILITY_CACHE_TTL_MS, TTLCache maxSize 500) and the new lastKnownContextLength memo (24h, AI_DEFAULTS.MODEL_CONTEXT_LENGTH_MEMO_TTL_MS, TTLCache maxSize 500). Both are Tier 1 - recomputable from the OpenRouter catalog, loss is correctness-neutral.

What: add both rows to the Existing Cache Implementations table. Verify each TTL against the constant at the moment of writing, per that section own instruction.

Acceptance: both rows present with TTL, tier, and type columns matching the source constants.

Blocker: .claude/rules edits are review-gated and are excluded by the current Opus-5 orchestrator trial boundaries (TASK-513). Ride the next .claude/rules PR alongside TASK-520, TASK-523, TASK-531.

Surfaced by the PR 2068 review (finding 3), which correctly noted the capabilityCache half predates that PR.
<!-- SECTION:DESCRIPTION:END -->
