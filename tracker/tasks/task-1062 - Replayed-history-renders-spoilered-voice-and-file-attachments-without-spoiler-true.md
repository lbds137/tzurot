---
id: TASK-1062
title: >-
  Replayed history renders spoilered voice and file attachments without
  spoiler="true"
status: To Do
assignee: []
created_date: '2026-09-23 22:33'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 1056000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1053 (feat/task-1053-spoiler-labels-all-kinds) makes live voice/file/audio elements carry spoiler="true" and a spoiler header. Two element producers build from persisted data that has no spoiler field, so a spoilered clip replayed from history renders without the attribute: services/ai-worker/src/jobs/utils/conversationUtils.ts toRenderableAttachments (builds from voiceTranscripts: string[]) and the unmatched-entry fallback in services/ai-worker/src/services/prompt/storedReference.ts buildStoredAttachments (builds from AttachmentEnrichment, which has no spoiler field). Correction from claude-review on PR #2492: that storedReference fallback drops the flag for BOTH voice and image enrichment rows, not voice only; images matched to an attachment row are fine (they go through buildRenderableAttachments).
Fix shape: persist the spoiler bit next to the stored voice transcript / enrichment (additive optional field on the persisted shape, so old rows read as not-spoilered), thread it into both builders via attachmentSpoiler, and pin replay parity with a test that renders the same spoilered voice clip live and from history.
Acceptance: a spoilered voice or file attachment renders spoiler="true" identically on the live and replayed paths; rows written before the change still parse and render unspoilered.
Depends on: TASK-1053 merging.
<!-- SECTION:DESCRIPTION:END -->
