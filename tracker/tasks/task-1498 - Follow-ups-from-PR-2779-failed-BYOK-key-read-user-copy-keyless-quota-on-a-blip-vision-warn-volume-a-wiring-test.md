---
id: TASK-1498
title: >-
  Follow-ups from PR #2779 (failed BYOK key read): user copy, keyless quota on a
  blip, vision warn volume, a wiring test
status: To Do
assignee: []
created_date: '2026-11-21T18:36:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1498000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review round 5 on PR #2779 (TASK-1486) found four non-blocking items, deferred at the round cap.

1. User copy: classifyPipelineFailure maps ApiKeyLookupError to SERVER_ERROR, whose USER_ERROR_MESSAGES copy (packages/common-types/src/constants/error.ts:282) says the AI service is having issues; the fault is our database. Give the ApiKeyLookupError arm its own userActionMessage via the approved-copy path, or a category whose copy does not name the AI service. User-visible, so the wording is the owner call.
2. Keyless quota: ImageDescriptionJob.resolveGuestMode treats any throw, ApiKeyLookupError included, as authenticated, so on a blip a keyless user skips the guest branch and the broad free fallback consumes their per-user daily vision quota. Option: return true (guest) on ApiKeyLookupError, so resolveGuestKey serves them on the system key without quota.
3. Warn volume: one image tier on a blip logs the resolver warn up to three times plus the probe, own-plan and broad-fallback warns, per tier walked. Drop the caller-side warns to debug for ApiKeyLookupError (the resolver line carries the Prisma error).
4. Wiring test: one test with a real ApiKeyResolver (only findFirst rejecting) behind a real ProviderRouter and AuthStep, asserting the step throws ApiKeyLookupError and nothing is cached (02-code-standards Core Principles 7).
5. Overclaiming comment: the LLMGenerationHandler class docstring says thrown exceptions (validation errors) are the only path to the BullMQ failed queue. AIJobProcessor can also throw from markMessageProcessing (Redis, before its try) and from logUsage inside it. Reword to what is true, or hedge it (found by the merge gate on PR #2779; it replaced an equally unverified line about retries).

Declined in the PR (not part of this task): propagating a z.ai probe read failure instead of skipping auto-promotion. The personality is configured on an OpenRouter z-ai model, so serving it on the user OpenRouter key is the configured route, not a reroute; round 3 asked for the skip.

Acceptance: each item shipped with a test, or a recorded reason not to.
<!-- SECTION:DESCRIPTION:END -->
