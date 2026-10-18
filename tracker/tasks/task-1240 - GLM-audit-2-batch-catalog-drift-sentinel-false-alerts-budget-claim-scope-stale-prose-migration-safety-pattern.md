---
id: TASK-1240
title: >-
  GLM audit 2 batch: catalog drift sentinel + false alerts, budget-claim scope,
  stale prose, migration-safety pattern
status: To Do
assignee: []
created_date: '2026-10-18 11:54'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1228000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a read-only code audit of the develop range 2ddcc4240..8da53b6dd (2026-10-18) found two medium and seven low defects. None is runtime-confirmed; each needs its premise re-verified against the code before fixing. Ninth finding (tailnet hostname in a public commit message) was ruled ACCEPT by the owner 2026-10-18: no action.

What (one PR, implemented by agy, driver reviews):
- MEDIUM A1: services/api-gateway/src/services/CatalogDriftChecker.ts sets the per-pair sentinel (no TTL) in evaluatePair() before check() enqueues the alert job; if addValidatedJob throws, the next refresh tick is suppressed and the owner is never alerted. Fix: set sentinels only after the enqueue resolves (or clear the cycle's sentinels on enqueue failure); test the failure path.
- MEDIUM A2: the same checker treats any lookup.kind other than resolved as drift, so a z.ai-only preset (z-ai/... validated against the z.ai catalog, see utils/modelValidation.ts) or a router alias absent from the OpenRouter list posts a false left-the-catalog alert and a permanent sentinel; unavailable is also treated as drift. Fix: skip non-OpenRouter targets and treat unavailable as skip.
- LOW A3: LLM_JOB_BUDGET comment (common-types constants/timing.ts) reads as a delivery guarantee under the 1080s coordinator flush, but the deadline is stamped at GenerationStep entry, after preprocessing. Either stamp from job start or scope the comment.
- LOW A4: docs/proposals/backlog/free-tier-zai-piggyback.md says zaiHeadroomPercent is now 90; systemSettingsRegistry.ts fallback is still 75. Check the prod AdminSettings row, then align fallback or doc.
- LOW A5: drift-ignore.json memories_chunk_group_id_idx.createPattern accepts WHERE ... IS NOT NULL OR true and a block-commented WHERE, and rejects parenthesized or table-qualified correct forms; check-migration-safety.ts strips only whole-line comments. Overlaps TASK-1200 (archived but still To Do): absorb it here.
- LOW B1: archiveSplitRenderPersonalities descriptions (common-types schemas/api/systemSettings.ts and systemSettingsRegistryOperations.ts) and the MemoryFormatter MEM-ARCH-002 comment still say split mode omits assistant prose; MEM-ARCH-038 added the capped own-note excerpt.
- LOW B2: tooling eslint no-message-metadata-rmw misses a string-literal computed receiver (prisma['conversationHistory'].update); handle it or list it in the documented gaps.
- LOW B3: garbled sentence in bot-client observability/commandOutcomeSlot.ts header about the noteRenderedOutcome caller set.
- LOW B4: CURRENT.md beta.237 watch says the character side is present on every own-note render; scope it to parseable, non-chunk, non-empty own notes.

Acceptance: each item fixed with a test where behavior changes (A1, A2, A3 if code, A5, B2) or the prose corrected; TASK-1200 closed by this PR.
<!-- SECTION:DESCRIPTION:END -->
