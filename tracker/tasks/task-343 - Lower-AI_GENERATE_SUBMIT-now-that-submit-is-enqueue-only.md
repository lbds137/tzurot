---
id: TASK-343
title: Lower AI_GENERATE_SUBMIT now that submit is enqueue-only
status: To Do
assignee: []
created_date: '2026-07-28 19:30'
labels:
  - 'size:S'
dependencies: []
priority: low
ordinal: 343000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the 60s bot-client timeout for AI generate submission was sized for the era when api-gateway downloaded extended-context attachments synchronously in the handler (observed >10s on 12-attachment payloads). That work moved to ai-worker DownloadAttachmentsStep, so the submit path is enqueue-only and the 60s cap is pure historical headroom.
Fix shape: measure real submit latency in prod logs (creationTimeMs is already logged by the generate handler), then drop AI_GENERATE_SUBMIT toward GATEWAY_RPC/GATEWAY_BULK_FETCH scale. Semantic change (timeout default) — measure first, never blind-lower.
Acceptance: constant lowered with a comment citing the measured p99; generate path verified in dev.
<!-- SECTION:DESCRIPTION:END -->
