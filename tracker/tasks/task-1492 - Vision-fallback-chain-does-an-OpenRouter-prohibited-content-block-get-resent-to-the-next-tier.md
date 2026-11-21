---
id: TASK-1492
title: >-
  Vision fallback chain: does an OpenRouter prohibited-content block get resent
  to the next tier?
status: To Do
assignee: []
created_date: '2026-11-21T03:54:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1492000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: OpenRouter screens image inputs and rejects with "This request contains prohibited content." (OpenRouter docs, batch content-screening section); its classifier misjudges youthful-styled anime and ABDL art (owner report 2026-11-20). If the vision fallback chain (services/ai-worker/src/services/multimodal/visionFallbackChain.ts) treats that error as a retryable tier failure, one false positive is resent to every tier, multiplying flags against the owner account. Unverified: code not yet read.

What: read how the chain classifies that error; if it advances or retries, make a screening block terminal for the image (no resend, cached as a failure) with a test pinning it.

Acceptance: a test feeds the prohibited-content error shape and asserts exactly one provider call.
<!-- SECTION:DESCRIPTION:END -->
