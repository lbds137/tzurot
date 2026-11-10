---
id: TASK-1384
title: >-
  Orphan-loop shared-file marker covers only video/webm, so an uploaded
  audio/mpeg transcript renders as an unmarked voice
status: Done
assignee: []
created_date: '2026-11-10T07:34:00Z'
updated_date: '2026-11-10T13:34:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1367000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: ReferencedMessageFormatter.buildDedupedAttachments orphan loop (services/ai-worker/src/services/ReferencedMessageFormatter.ts, the AttachmentType.Audio branch) marks source=shared-file only when entry.metadata.contentType is video/webm. MultimodalProcessor transcribes any audio/* upload (services/ai-worker/src/services/MultimodalProcessor.ts ~273, metadata: attachment), so an uploaded song (audio/mpeg) whose URL misses the correlation join renders as an unmarked <voice>, outside the shared-media constraint. Rare: only on a correlation miss. Surfaced by claude-review round 3 on PR 2737.

What: gate on excluding the dependency-step placeholder (contentType audio/unknown, built in DependencyStep.ts) instead of requiring video/webm, keep the isVoiceMessage and own-persona checks, and add an audio/mpeg row to the ORPHAN audio entries tests. Same unit: processVoiceAttachment logs Transcribing voice message for uploaded audio too (AttachmentProcessor.ts); use neutral wording or log sharedFile.

Acceptance: an orphan audio/mpeg entry with no voice flag renders source=shared-file; the audio/unknown placeholder and flagged voice stay unmarked; tests pin all three.
<!-- SECTION:DESCRIPTION:END -->

## Notes

2026-11-10 premise correction (driver, while building): the orphan-loop half is OBSOLETE. preprocessing.referenceAttachments is built only by DependencyStep.buildPreprocessingResults from job results (contentType audio/unknown placeholder; restoreOriginalMetadata joins processedAttachments only), and the gateway queues reference STT jobs only for isVoiceMessage === true attachments (services/api-gateway/src/utils/jobChainOrchestrator.ts audioWorthTranscribing). An uploaded audio/mpeg on a referenced message is never transcribed, so it never reaches that loop. The MultimodalProcessor metadata: attachment premise (also used in PR 2737 review round 2) holds for trigger and extended-context processing, not for reference entries. The webm arm stays as a defensive branch with a comment saying so. The neutral transcription log wording ships with TASK-1381/1383.
