---
id: TASK-1527
title: >-
  Seam test: auto-promoted model unlisted on OpenRouter retries on z.ai with the
  full attempt budget
status: To Do
assignee: []
created_date: '2026-11-24T05:56:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1524000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR for TASK-1526 pins the fallback omission in ProviderRouter and the AuthStep wiring, and autoPromotionFallback.test.ts pins passthrough when fallback is undefined, but no single test runs LLMGenerationHandler -> AuthStep -> GenerationStep with a catalog probe returning false and a z.ai 429 (1305), asserting three z.ai attempts and zero OpenRouter calls. What: one wiring test mocking only Redis catalog + the model client. Acceptance: the test fails if the catalog probe is dropped from AuthStep or the fallback is attached anyway.
<!-- SECTION:DESCRIPTION:END -->
