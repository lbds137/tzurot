---
id: TASK-365
title: Reference rendering has FOUR hand-synced paths (live/stored x full/deduped)
status: To Do
assignee: []
created_date: '2026-07-30 23:08'
labels:
  - 'area:ai-worker'
dependencies: []
priority: high
ordinal: 365000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Surfaced 2026-07-30 by the TASK-364 investigation. This is the root antipattern behind that bug and its predecessor.**

A quoted reference is rendered by two independent renderers — `ReferencedMessageFormatter` (live) and `xmlMetadataFormatters` (stored history) — each with a full branch and a deduped branch. Four code paths that must agree, kept in sync BY HAND.

`buildDedupedReferenceStub` (`packages/common-types/src/utils/referenceEnrichment.ts:189-205`) is the concrete smell: it rebuilds the reference field-by-field, so any field nobody remembered to list is silently lost. Line 199 hand-carries `authorRole` — that line IS the scar from the first bug of this class (TASK-162, quoted role dropped on the deduped path). TASK-364 is the second: `attachments` dropped the same way.

**Council 3/3 (GLM 5.2 / Kimi K3 / Qwen 3.7 Max) independently proposed the same fix:** make the deduped stub a PROJECTION of the full render rather than a parallel reconstruction. The stub becomes `fullRender with content := stubMarker`. The exclusion set has exactly ONE member (`content`) — the only field the token motive targets and the only one history provably carries. Future fields are inherited by construction; adding a second exclusion becomes a conspicuous, reviewable event instead of a silent omission.

Kimi K3: "Any fix that preserves the parallel builder preserves the class." Qwen: "you are testing two independent code paths for accidental convergence."

**Acceptance:** one extraction/render core; deduped is a projection; a new field on the reference model reaches both renderers without a per-field edit, or fails to compile.
<!-- SECTION:DESCRIPTION:END -->
