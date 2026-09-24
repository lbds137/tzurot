---
id: TASK-1088
title: 'doc-9 Phase 1: explicit fallbackConfigId edge plus dashboard field'
status: To Do
assignee: []
created_date: '2026-09-24 21:13'
labels:
  - 'area:config-resolver'
  - 'area:api-gateway'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1081000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: doc-9 (Model Configuration Overhaul) shipped Phase 0 (tier-aware quota fallback) on 2026-07-06 and the slot moved on; the 2026-09-24 half-finished sweep found Phase 1 unnamed on any board. Converted from an epic remainder into a drain item by owner ruling 2026-09-24. Design: docs/proposals/backlog/llm-profiles-and-user-channel-tier.md (profile = preset + tier-filtered fallback edge). Sibling: TASK-188 wires the two write-only default pointers; check overlap before building.
Fix shape: the fallbackConfigId edge on LlmConfig, honoured by the Phase 0 fallback path before the tier-derived pick, plus the dashboard field to set it. Phase 2 (UserChannelConfig tier) stays in the theme doc, gated on the doc-15 cascade pattern.
Acceptance: a config with an explicit fallback retargets to it on QUOTA_EXCEEDED before any tier-derived choice, pinned by a test; the dashboard round-trip test covers the new field.
<!-- SECTION:DESCRIPTION:END -->
