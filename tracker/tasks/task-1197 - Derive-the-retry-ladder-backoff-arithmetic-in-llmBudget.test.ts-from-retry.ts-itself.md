---
id: TASK-1197
title: >-
  Derive the retry-ladder backoff arithmetic in llmBudget.test.ts from retry.ts
  itself
status: To Do
assignee: []
created_date: '2026-10-09 07:30'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1187000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: round-4 review on PR #2592 - LADDER_BACKOFF_MS re-derives withRetry delay formula by hand; if retry.ts changes its formula (not RETRY_CONFIG), the ladder-fit guard stays green while the real ladder drifts past LLM_INVOCATION. Options named by the reviewer: export the delay computation from retry.ts, or drive the real withRetry with fake timers against a stamped deadline.
Promote when: next touch of services/ai-worker/src/utils/retry.ts or the retry-ladder tests.
<!-- SECTION:DESCRIPTION:END -->
