---
id: TASK-407
title: >-
  detectProtocolFormat (tooling) must be re-checked when the protocol JSON
  schema changes
status: To Do
assignee: []
created_date: '2026-08-03 01:07'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:unreachable'
dependencies: []
priority: low
ordinal: 407000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/tooling/src/prompt/voice-probes.ts detectProtocolFormat deliberately duplicates ai-worker PersonalityFieldsFormatter.parseProtocolJson validation (tooling cannot import ai-worker internals). If production ever changes the protocol shape (new required field, looser validation), the miner will silently misclassify protocol formats.
Fix shape: when touching parseProtocolJson, update detectProtocolFormat in the same PR; the pinning test in voice-probes.test.ts (matches production fallback semantics) documents the contract but cannot see cross-package drift.
Surfaced by PR 1910 review.
<!-- SECTION:DESCRIPTION:END -->
