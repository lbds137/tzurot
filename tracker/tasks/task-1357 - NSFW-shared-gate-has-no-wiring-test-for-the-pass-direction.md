---
id: TASK-1357
title: NSFW shared gate has no wiring test for the pass direction
status: To Do
assignee: []
created_date: '2026-11-08T04:25:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1340000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: post-merge Opus audit of PR 2690 (NSFW gate evaluated once per multi-tag message), 2026-11-07. The fail-closed and block paths are pinned by wiring tests in services/bot-client/src/services/sharedNsfwGate.test.ts, but no test covers the PASS direction: a verified user in a non-NSFW channel tagging N characters should get N submitted jobs with exactly one getNsfwStatus call. The NSFW-channel first-verify test makes buildContext reject, so its slots never submit. A future change that made the shared gate return false after its first caller would not be caught by a wiring test.

What: add one wiring test through the real MultiTagCoordinator + createSharedNsfwGate with only the gateway client mocked: verified user, non-NSFW guild channel, 3-4 tagged personalities, assert every slot submits and the status call count is 1. Optionally a mixed case: gate passes, one slot later throws, the others submit.

Acceptance: the new test fails when the shared gate memo returns allowed:false to callers after the first (canary run and reported).
<!-- SECTION:DESCRIPTION:END -->
