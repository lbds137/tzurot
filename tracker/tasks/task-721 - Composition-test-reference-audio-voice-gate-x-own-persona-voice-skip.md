---
id: TASK-721
title: 'Composition test: reference-audio voice gate x own-persona-voice skip'
status: To Do
assignee: []
created_date: '2026-08-21 23:14'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 721000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2176 review noted audioWorthTranscribing and the pre-existing isOwnPersonaVoice skip both filter the same audio array in processAttachmentsForJobs (jobChainOrchestrator.ts) with no single test exercising a reference that is BOTH non-voice audio AND own-persona authored. They compose by inspection (independent boolean conditions, no shared state) and each has its own tests.

Fix shape: one test in jobChainOrchestrator.test.ts with a referenced message carrying non-voice audio authored by the own persona, asserting no STT job dispatches and the composition order does not matter.

Acceptance: the intersection is pinned by a test that fails if either gate is removed.

Promote when: any real bug report exercises the voice-gate/persona-skip intersection.
<!-- SECTION:DESCRIPTION:END -->
