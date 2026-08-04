---
id: TASK-429
title: >-
  Reference-pipeline failure logs are uncorrelated — consider a requestId-bound
  child logger
status: To Do
assignee: []
created_date: '2026-08-04 15:00'
labels:
  - 'area:ai-worker'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 429000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the enrichment-drop tripwires now carry requestId, but the three logger.error sites in AttachmentProcessor.ts (attachment processing, image, voice transcription failures) do not. Lower severity than the tripwires — they fire at failure time with err+url — but the same correlation gap.
Fix shape: rather than threading requestId as a parameter into every helper, evaluate binding it once via a pino child logger at the formatter/processor entry point; that would correlate every log in the path and could later replace the per-param threading.
Acceptance: failure logs in the reference pipeline carry requestId, or the approach is ruled out with the reason in the removing commit.

Rider (review nit from the echo-retry PR): add a one-line comment on MIN_LENGTH_FOR_ECHO_CHECK (RetryDecisionHelper.ts) noting why it is 40 while the cross-turn detector uses MIN_LENGTH_FOR_SIMILARITY_CHECK = 30 — deliberately stricter because a false-positive echo retry burns a paid generation, unlike a false-positive dedup comparison.
<!-- SECTION:DESCRIPTION:END -->
