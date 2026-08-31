---
id: TASK-842
title: >-
  Stored-reference orphan enrichment cannot carry image provenance — persisted
  shape has no slot
status: To Do
assignee: []
created_date: '2026-08-31 14:38'
labels:
  - 'area:ai-worker'
  - 'area:common-types'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 842000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2270 round-3 orchestrator class-sweep (code-read, not runtime-confirmed): the STORED-path orphan loop (services/ai-worker/src/services/prompt/storedReference.ts:155 — verify, cites drift) pushes { kind: image, description } with no source, while its correlated arm gets provenance via buildRenderableAttachments. Unlike the live-path sibling fixed in PR 2270, this is NOT a one-line fix: attachmentEnrichmentSchema (packages/common-types/src/types/schemas/message.ts:122) persists only { url, kind, description } — the stored shape has nowhere to put provenance, so an orphaned stored enrichment for an embed preview or sticker replays as a plain image.

Fix shape: add an optional source field to attachmentEnrichmentSchema (Zod-declared so safeParse keeps it, with a survival test per the isEmbedPreview precedent), populate it where enrichment is persisted (trace the write path from ProcessedAttachment to the stored row), and read it in the storedReference orphan loop. Old rows lack the field and render exactly as today — no backfill. Note the CORRELATED stored arm already works because it reads the attachments row metadata; only the orphan (URL-correlation-miss) arm is blind.

Acceptance: an orphaned stored enrichment whose original attachment carried isEmbedPreview/isSticker renders with the matching source attribute; a test pins it; absent-field rows keep rendering unchanged.
<!-- SECTION:DESCRIPTION:END -->
