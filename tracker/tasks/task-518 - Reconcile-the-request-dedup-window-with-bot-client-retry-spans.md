---
id: TASK-518
title: Reconcile the request-dedup window with bot-client retry spans
status: To Do
assignee: []
created_date: '2026-08-11 02:30'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 518000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2061 gave the generation submit a bounded retry spanning ~14s, while api-gateway REQUEST_DEDUP_WINDOW is 5s (packages/common-types/src/constants/timing.ts) and the dedup entry is only written AFTER createJobChain succeeds (services/api-gateway/src/routes/ai/generate.ts). PR 2061 narrowed the submit retry to connection failures only, so the ambiguous cases (timeout, 5xx) no longer repeat a request the gateway may already have turned into a paid job. The residual: a network-kind failure also covers a mid-flight reset, where the request DID land, and a retry landing more than 5s later misses the dedup cache and creates a second job plus a second reply.

What: decide whether the dedup window should cover the worst-case retry span (widening it changes dedup semantics for a user legitimately re-sending the same message, which is why this is not an agent-side call), or whether the submit should carry an idempotency key the gateway honours regardless of window. Surfaced by the claude-review on PR 2061 (Medium, code-read mechanism, not runtime-observed).

Acceptance: either the window and the retry span are reconciled with the reasoning recorded, or an idempotency key makes the window irrelevant for this path.
<!-- SECTION:DESCRIPTION:END -->
