---
id: TASK-29
title: 'Comment: withParallelRetry is a no-op on the vision-fallback path'
status: To Do
assignee: []
created_date: '2026-07-02 00:00'
labels:
  - 'origin:review'
dependencies: []
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Comment: `withParallelRetry` is a no-op on the vision-fallback path

**Why:** `MultimodalProcessor.processAttachments` still wraps `processSingleAttachment` in `withParallelRetry`, but on the Phase-4 path `describeImageWithFallback` never throws by contract — the outer retry can never fire. Harmless, but a future reader will misattribute where retries happen. **Fix shape**: one comment at the wrap site noting the fallback-loop path retries internally (tier loop) and the outer wrapper only covers non-vision attachment types. **Promote when**: next touching MultimodalProcessor. Surfaced 2026-07-02 (release #1439 holistic review).
<!-- SECTION:DESCRIPTION:END -->
