---
id: TASK-563
title: Reference-path audio bucket bills STT for non-voice audio nothing renders
status: To Do
assignee: []
created_date: '2026-08-12 22:33'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 563000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: pre-existing cost gap surfaced by the #2056 seam trace - same class as the shipped TASK-512, one predicate over. categorizeAttachments (jobChainOrchestrator.ts:51-56) enqueues billed STT for ANY audio/* attachment on a referenced message, but the ai-worker reference render path consumes transcripts only for isVoiceMessage === true (classifyAttachment in QuoteFormatter.ts:108-119; findPreprocessedByUrl is the sole reference-transcript consumer, reached only via the voice arm). So an mp3 in a quoted message triggers real STT spend whose output is discarded. Related asymmetry worth a comment: the gateway assistant-reference skip covers ALL audio while the worker guards voice-only - benign today, a latent drift point if a non-voice reference-audio consumer is ever added.

Fix shape: gate the reference-path audio bucket on isVoiceMessage, mirroring classifyAttachment; add the scope comment.

Acceptance: non-voice reference audio creates no STT job (pinned); current-message audio path unchanged. Source: 2026-08-12 review (api-gateway reviewer MED-1 PLAUSIBLE code-read + LOW-1 CONFIRMED).
<!-- SECTION:DESCRIPTION:END -->
