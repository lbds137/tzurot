---
id: TASK-1379
title: >-
  Trigger audio silently absent when any other preprocessed attachment exists
  and its STT job failed
status: To Do
assignee: []
created_date: '2026-11-10T02:50:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1362000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: ConversationInputProcessor.ts:150-157 uses preprocessedAttachments whenever the list is non-empty, and falls back to inline processing only when it is empty. DependencyStep.fetchAudioResult (DependencyStep.ts:216-234) returns null for a failed audio job, so a message with an image (described) plus a voice message (STT failed) reaches the prompt with the image only and no sign the audio existed.

Status: inferred from code reading during TASK-813 grounding (2026-11-09), not runtime-confirmed; check first whether a failure notice for the audio reaches the user or prompt by another route (failureReason on AudioTranscriptionResult, jobs.ts:335-337).

Fix shape: either a per-attachment inline retry for the missing item, or a placeholder attachment (the untranscribed state the quote path already renders) so the model knows audio was sent.

Acceptance: a trigger with a described image and a failed voice transcription still tells the model a voice message was sent; pinned by a test.
<!-- SECTION:DESCRIPTION:END -->
