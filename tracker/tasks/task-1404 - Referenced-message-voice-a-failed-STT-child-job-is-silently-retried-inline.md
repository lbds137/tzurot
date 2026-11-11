---
id: TASK-1404
title: 'Referenced-message voice: a failed STT child job is silently retried inline'
status: To Do
assignee: []
created_date: '2026-11-11T04:09:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:owner
dependencies: []
priority: medium
ordinal: 1385000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a failed STT child job for a voice message on a referenced message produces no entry in referenceAttachments (buildPreprocessingResults routes successes only), so ReferencedMessageFormatter gets no preprocessed entry and AttachmentProcessor.processVoiceAttachment (AttachmentProcessor.ts:334-358) re-transcribes inline with withRetry, a second paid attempt; on failure it degrades to status untranscribed (AttachmentProcessor.ts:372-373; QuoteFormatter.ts:86,120,234). The owner ruled on 2026-11-10 that a failed trigger image/audio job renders a notice with no inline retry (TASK-1395, PR 2741); the reference path still retries. An empty successful STT on a reference is dropped the same way and re-transcribed. Found by the PR 2741 review round (code-reading, not runtime-confirmed).
What: carry reference-numbered STT failures and empties into the reference render as untranscribed / no speech without an inline retry, if the owner extends the ruling.
Acceptance: a test with a failed reference STT job shows no transcribeAudio call and renders the untranscribed voice element.
Owner question: should the no-inline-retry ruling for failed trigger media also apply to quoted (referenced) voice messages?
Recommendation: yes - same spend logic (the job already retried), and the untranscribed state already renders honestly.
<!-- SECTION:DESCRIPTION:END -->
