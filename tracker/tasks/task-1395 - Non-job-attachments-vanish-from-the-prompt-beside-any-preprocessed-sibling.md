---
id: TASK-1395
title: Non-job attachments vanish from the prompt beside any preprocessed sibling
status: To Do
assignee: []
created_date: '2026-11-10T14:30:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: high
ordinal: 1378000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the gateway queues preprocessing jobs only for audio and image attachments (services/api-gateway/src/utils/jobChainOrchestrator.ts:44-58 categorizeAttachments). In ai-worker, ConversationInputProcessor.ts:150 uses context.preprocessedAttachments whenever it is non-empty and skips the inline path for every other attachment. So a trigger with photo.png + report.pdf gives the model the image description but no [File: report.pdf] header, while the same PDF sent alone does get it. visionDescriptionWriter (services/ai-worker/src/services/context/visionDescriptionWriter.ts ~82-92) then rewrites the stored trigger content, dropping the bot-client [File: ...] placeholder from history (code-reading, not runtime-confirmed). Same for an audio-only plain video/webm beside an image.
Wider form of TASK-1379. Found by the Fable attachment-provenance architecture review 2026-11-10 (D1); structural fix is the attachment-spined preprocessing redesign (see the provenance redesign doc), but a narrow fix (merge inline handling for attachments with no job) can land first.
Acceptance: a seam test with image + pdf on the trigger renders both; history keeps the file header.
<!-- SECTION:DESCRIPTION:END -->
