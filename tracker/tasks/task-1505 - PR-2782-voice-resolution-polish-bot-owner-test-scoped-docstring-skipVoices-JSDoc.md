---
id: TASK-1505
title: >-
  PR 2782 voice-resolution polish: bot-owner test, scoped docstring, skipVoices
  JSDoc
status: To Do
assignee: []
created_date: '2026-11-22T04:53:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1505000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2782 claude-review r1 low-severity findings on voice-resolution. What: (1) add a bot-owner bypass test for a private character in services/api-gateway/src/routes/user/voice-resolution.test.ts; (2) scope the TTL/no-pub-sub docstring in services/api-gateway/src/routes/user/voice-resolution.ts:51-53 specifically to the per-handler TtsConfigResolver/SttResolver instances (cascadeResolver is pub/sub-invalidated); (3) document in packages/common-types/src/schemas/api/voice-resolution.ts that voices is an empty placeholder when skipVoices=true. Acceptance: bot-owner test passes and both comments/JSDoc match runtime behavior.
<!-- SECTION:DESCRIPTION:END -->
