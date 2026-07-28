---
id: TASK-236
title: Submit-failure errored slots dropped in a PARTIAL-success multi-tag batch
status: To Do
assignee: []
created_date: '2026-07-08 00:00'
updated_date: '2026-07-28 10:51'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 236000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Submit-failure errored slots dropped in a PARTIAL-success multi-tag batch — PR-E delivers per-persona in-character errors only when EVERY slot failed (`runtimeSlots.length === 0`). If a batch mixes submitted + submit-errored slots (e.g. 2 succeed, 1's `submitChatJob` throws), the errored persona's outcome is collected but never delivered — silently dropped (pre-existing; the old `anyInfraError` boolean had the same restriction). NOTE: post-submission job failures (RuntimeSlot.status==='errored') ARE delivered via deliverGroup — this gap is ONLY submit-throws in a partial batch (rare: a gateway write-timeout on one slot while others submit fine). **Fix shape**: deliver `erroredOutcomes` alongside the group even when runtimeSlots>0 (route through deliverErrorNoPersist in the ordered burst). **Promote when**: product confirms 'every errored character always speaks', or a user reports a silently-missing character in a partial-failure multi-tag. Surfaced 2026-07-08 (PR #1561 round-3 review).

**Why:** Completeness of the in-character error guarantee across partial vs total failure.
<!-- SECTION:DESCRIPTION:END -->
