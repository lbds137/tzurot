---
id: TASK-1378
title: >-
  Voice trigger row content may be re-wrapped as a transcript: header and
  voice_transcripts nested twice
status: To Do
assignee: []
created_date: '2026-11-10T02:50:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1361000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: persistTriggerDescriptions (services/ai-worker/src/services/context/visionDescriptionWriter.ts, called from DependencyStep.ts:173-184) upgrades a voice trigger stored content to the rendered descriptions, i.e. a header plus <voice_transcripts><transcript>T</transcript></voice_transcripts> (RAGUtils.ts:147-150). Two readers treat row.content as the bare transcript: ContextAssembler.resolveVoiceTranscript (ContextAssembler.ts:689-691) and the enrichReferences retrieveTranscript closure (ContextAssembler.ts:421-428, whose comment says the row IS the transcript). Their output is wrapped again by formatVoiceSection (xmlMetadataFormatters.ts:268-280) or appendVoiceTranscripts (referenceEnrichment.ts:153-175), so the model may see a header and a nested wrapper inside a transcript.

Status: inferred from code reading (Explore trace during TASK-813 grounding, 2026-11-09), NOT runtime-confirmed. First step: a seam test that persists a voice trigger through persistTriggerDescriptions and reads it back through resolveVoiceTranscript, asserting the returned text; or a dev DB read of an upgraded voice row.

Fix shape (if confirmed): store or extract the bare transcript for these readers (e.g. strip via the shared header/wrapper vocabulary), and correct the comment at ContextAssembler.ts:419-421.

Acceptance: a replayed or quoted voice message renders its transcript once, unwrapped inside the outer element; pinned by a seam test.
<!-- SECTION:DESCRIPTION:END -->
