---
id: TASK-633
title: Guest-note trace-back lost when a later retarget overwrites it
status: To Do
assignee: []
created_date: '2026-08-16 22:48'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 633000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-620 shipped the guest_mode footer announce (PR #2118). A guest request whose substituted free model is ITSELF doomed (rate-limited/exhausted) has its guest note OVERWRITTEN in resolveLlmAuthWithQuotaCheck: applyProactiveQuotaFallback unconditionally sets quotaFallback to its own info, whose fromModel is the already-substituted free model - so the footer reads e.g. "free-default -> other-free (rate limited)" with no trace of the originally-configured paid model. The 2118 reviewer traced reachability: applyProactiveQuotaFallback is the ONLY reachable overwrite for genuine guest routes (tryPromotionDemotion bails via the fallback.isGuestMode guard). composeQuotaFallbackInfo already trace-backs reactive-over-guest correctly (pinned by test); the gap is this proactive-overwrite site.
Fix shape: make the overwrite compose instead of replace - preserve the guest carrier original fromModel when a later proactive info lands on a guest_mode carrier (compose-style merge at the applyProactiveQuotaFallback return site).
Acceptance: a guest request whose free model then hits applyProactiveQuotaFallback renders a footer whose fromModel is the originally-configured model; test pins it.
<!-- SECTION:DESCRIPTION:END -->
