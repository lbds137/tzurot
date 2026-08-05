---
id: TASK-33
title: Align result.error compose base with errorInfo.technicalMessage
status: Done
assignee: []
created_date: '2026-07-02 00:00'
updated_date: '2026-08-05 23:08'
labels:
  - 'origin:review'
  - 'area:ai-worker'
  - 'size:S'
  - 'state:unreachable'
dependencies: []
priority: low
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Align `result.error`'s compose base with `errorInfo.technicalMessage` (RetryError wrapper text)

**Why:** `GenerationStep`'s catch composes the log-only `result.error` from the OUTER error's message (`composeFallbackAwareErrorMessage(error)`) while `errorInfo.technicalMessage` derives from the UNWRAPPED `underlyingError` — when the outer is a `RetryError`, `result.error` leads with the generic wrapper text ("… failed with non-retryable error") instead of the root cause. Pre-existing asymmetry (predates the compound-fallback work) made more visible by it. **Fix shape**: have `composeFallbackAwareErrorMessage` take the unwrapped base (or accept `underlyingError`), mirroring `withFallbackFailure`. Log/diagnostics-only impact. **Promote when**: next touching GenerationStep's error path. Surfaced 2026-07-02 (PR #1438 round-3 review, non-blocking).
<!-- SECTION:DESCRIPTION:END -->
