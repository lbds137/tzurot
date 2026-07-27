---
id: TASK-33
title: "Align result.error's compose base with errorInfo.technicalMessage (RetryError wrapper…"
status: To Do
assignee: []
created_date: '2026-07-02 00:00'
labels:
  - 'origin:review'
dependencies: []
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Align `result.error`'s compose base with `errorInfo.technicalMessage` (RetryError wrapper text)

**Why:** `GenerationStep`'s catch composes the log-only `result.error` from the OUTER error's message (`composeFallbackAwareErrorMessage(error)`) while `errorInfo.technicalMessage` derives from the UNWRAPPED `underlyingError` — when the outer is a `RetryError`, `result.error` leads with the generic wrapper text ("… failed with non-retryable error") instead of the root cause. Pre-existing asymmetry (predates the compound-fallback work) made more visible by it. **Fix shape**: have `composeFallbackAwareErrorMessage` take the unwrapped base (or accept `underlyingError`), mirroring `withFallbackFailure`. Log/diagnostics-only impact. **Promote when**: next touching GenerationStep's error path. Surfaced 2026-07-02 (PR #1438 round-3 review, non-blocking).
<!-- SECTION:DESCRIPTION:END -->
