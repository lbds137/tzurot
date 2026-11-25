---
id: TASK-1541
title: Record the OpenRouter upstream host on failed generations
status: To Do
assignee: []
created_date: '2026-11-25T09:09:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1539000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: thrown generation failures (generationFailureResult.ts recordPartialLlmResponse) carry no reasoningDebug, so telemetry:upstream buckets them under (none). A censoring host that errors (moderation 4xx/403) instead of returning content_filter is exactly the TASK-1261 routing signal and is lost. What: when the thrown error carries OpenRouter error.metadata.provider_name, record it as reasoningDebug.upstreamProvider (or an error-side field the report reads). Verify first with a probe that OpenRouter error bodies carry provider_name. Acceptance: a failed request diagnostic row names its upstream host; telemetry:upstream attributes it; a test asserts the field crosses the recorder seam.

Retry capture gap (found while documenting telemetry:upstream): a retried request keeps only the host of the last attempt that recorded a response. DiagnosticCollector.recordLlmResponse overwrites on each successful attempt, and recordPartialLlmResponse skips once a response is set, so a final attempt that fails before recording leaves the earlier attempt's host in place. Earlier attempts' hosts are not recorded at all. Fixing this needs per-attempt capture, not a change to the thrown-error path alone.
<!-- SECTION:DESCRIPTION:END -->
