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
Why: the gateway queues preprocessing jobs only for audio and image attachments (planPreprocessing in packages/common-types/src/utils/attachmentPreprocessingPlan.ts, called from jobChainOrchestrator.ts processAttachmentsForJobs; non-media lands in its unconsumed `files` bucket). In ai-worker, ConversationInputProcessor.ts:150 uses context.preprocessedAttachments whenever it is non-empty and skips the inline path for every other attachment. So a trigger with photo.png + report.pdf gives the model the image description but no [File: report.pdf] header, while the same PDF sent alone does get it. visionDescriptionWriter (services/ai-worker/src/services/context/visionDescriptionWriter.ts ~82-92) then rewrites the stored trigger content, dropping the bot-client [File: ...] placeholder from history (code-reading, not runtime-confirmed). Same for an audio-only plain video/webm beside an image.
Wider form of TASK-1379. Found by the Fable attachment-provenance architecture review 2026-11-10 (D1); structural fix is the attachment-spined preprocessing redesign (see the provenance redesign doc), but a narrow fix (merge inline handling for attachments with no job) can land first.
Acceptance: a seam test with image + pdf on the trigger renders both; history keeps the file header. The TASK-1398 seam (attachmentProvenanceChainSeam.test.ts) pins this as KNOWN_RED entries tagged TASK-1395 (pdf and audio-only-webm, trigger-job, visible + enrichment): the fix moves them out of KNOWN_RED.
Build note (PR 2740 review): `files` is NOT every attachment without a job. Non-voice audio on a referenced message is only counted (skippedNonVoiceReferenceAudio), and own-persona-voice audio is skipped after the plan in processAttachmentsForJobs. Decide what "job-less" means here and fix the `files` JSDoc in attachmentPreprocessingPlan.ts to match (it currently says this fix consumes it).
In progress 2026-11-10, folded with TASK-1396 and TASK-1379 (same DependencyStep lines). Design: DependencyStep emits one processed entry per original trigger attachment, in original order. Owner ruling (Lila, 2026-11-10, via AskUserQuestion): a failed image/audio job renders a failure notice with no inline retry, including when every job failed (ends the hidden all-failed inline retry). Own-persona-voice and non-voice skips are reference-only (jobChainOrchestrator.ts:270), so they never leave a trigger attachment job-less.
<!-- SECTION:DESCRIPTION:END -->
