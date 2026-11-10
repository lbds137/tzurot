---
id: TASK-1383
title: >-
  Audio header fallback labels a genuine voice message as [Audio: name], now
  read as maybe-not-their-speech
status: To Do
assignee: []
created_date: '2026-11-10T06:39:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1366000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: since TASK-813 the OUTPUT_CONSTRAINTS provenance line reads a transcript under [Audio: name] as possibly someone else's recording. Two routes still give a genuine voice message that header: buildAudioAttachmentHeader (services/ai-worker/src/services/RAGUtils.ts) falls back to [Audio: name] when isVoiceMessage is true but duration is missing or not positive, and DependencyStep.restoreOriginalMetadata (services/ai-worker/src/jobs/handlers/pipeline/steps/DependencyStep.ts) keeps placeholder metadata with no isVoiceMessage on a join miss (TASK-1381 logs that miss). Both are rare: bot-client sets isVoiceMessage only with a duration, and the join keys on the CDN URL.

What: label on isVoiceMessage alone (a voice header without the seconds when duration is absent), with a test for the no-duration case; the join-miss half rides on TASK-1381.

Acceptance: a flagged voice message never renders an [Audio: name] header; test pins the no-duration case.
<!-- SECTION:DESCRIPTION:END -->
