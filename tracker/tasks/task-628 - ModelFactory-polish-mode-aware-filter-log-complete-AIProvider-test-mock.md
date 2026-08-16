---
id: TASK-628
title: 'ModelFactory polish: mode-aware filter log + complete AIProvider test mock'
status: To Do
assignee: []
created_date: '2026-08-16 16:59'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 628000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: two low-severity review findings from #2112 routed here at the round cap (round 6).

1. filterRestrictedParams logs "Filtered unsupported params for restricted model to prevent 400 errors" for BOTH filter modes, but on the z.ai allow-mode path the stripped params would have been silently ignored, not 400d — the log rationale contradicts the allowlist justification. Fix shape: mode-aware message (or drop the rationale clause).

2. ModelFactory.test.ts mocks @tzurot/common-types/constants/ai with an AIProvider missing Mistral (pre-existing) — a future Mistral-path test in that file silently gets undefined instead of the real enum value. Fix shape: add Mistral to the mock or import the real enum like thinkingTranslation.test.ts does.

Acceptance: the warn message names what actually happens per mode; the test mock carries all AIProvider members (or the mock is replaced by the real enum).
<!-- SECTION:DESCRIPTION:END -->
