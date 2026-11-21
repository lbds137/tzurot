---
id: TASK-1489
title: >-
  PR 2776 follow-ups: secondary-probe policy comments and the
  resolveUserOpenRouterKey never-throw test
status: To Do
assignee: []
created_date: '2026-11-21T03:08:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1489000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2776 (TASK-1359) review round 5 left five small non-blocking items. The never-throw contract of ApiKeyResolver.resolveUserOpenRouterKey now rests on its catch-all alone, because getUserApiKey can throw UndecryptableApiKeyError and EncryptionMisconfiguredError; a regression there would replace the original quota error in quota-fallback handling. That is the item that earns medium.

What: (1) a test that resolveUserOpenRouterKey returns undefined, without throwing, for both new error classes; (2) a JSDoc line on resolveUserOpenRouterKey saying an undecryptable row reads as no own key; (3) describeImageWithFallback userHasOpenRouterKey: name why the UndecryptableApiKeyError arm stays at debug (probeUserVisionKey already warns on the same row); (4) ImageDescriptionJob resolveGuestMode docstring: drop the temporal now and cover the z.ai-coding probe too; (5) AIJobProcessor STT key comment: mirror the AuthStep audio deliberate-tolerance wording.

Acceptance: the test goes red if the catch-all is narrowed; comments state invariants only.
<!-- SECTION:DESCRIPTION:END -->
