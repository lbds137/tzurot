---
id: TASK-1365
title: 'late recovery: close the PR 2723 final-round review lows'
status: To Do
assignee: []
created_date: '2026-11-08T18:16:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1348000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2723 (TASK-823) merged after its fourth claude-review round with no blockers; the remaining lows are recorded here instead of a fifth round.

What (files: services/bot-client/src/handlers/lateResultRecovery.ts, lateResultRecovery.test.ts, MessageHandler.ts):
1. The fetchTypingChannel-rejects case in lateResultRecovery.test.ts tests an unreachable path (the real fetchTypingChannel catches and returns null, which routes to channel-missing). Drop it or relabel it as a defensive outer-catch check.
2. Move the success logger.info out of the send try so only sendResponse decides send-failed vs delivered.
3. The exact-args success test does not assert the buildResultMetadataPassthrough spread; assert it and prove the assertion red by removing the spread.
4. Two change-history comments: lateResultRecovery.ts header (Extracted from MessageHandler ...) and the MessageHandler stale-discard comment (now costs ... instead of ...); restate them as current behavior.

Acceptance: all four applied; bot-client test, typecheck, lint green; the new passthrough assertion shown red without the spread.
<!-- SECTION:DESCRIPTION:END -->
