---
id: TASK-633
title: Guest-note trace-back lost when a later retarget overwrites it
status: To Do
assignee: []
created_date: '2026-08-16 22:48'
updated_date: '2026-09-04 19:38'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. confirmed live bug, exactly as described. `applyProactiveQuotaFallback` still sets `info.fromModel: personality.model` (the already-substituted model) unconditionally, and the caller (`resolveLlmAuthWithQuotaCheck`) still does `quotaFallback: proactive.info` — a plain overwrite of the prior guest carrier's note, not a compose. A guest whose substituted free model then hits proactive fallback would still get a footer with no trace of the originally-configured paid model. Evidence: `sed -n '196,220p' services/ai-worker/src/jobs/handlers/pipeline/steps/AuthStep.ts` → `quotaFallback: proactive.info` unconditional overwrite; `sed -n '303,317p'` same file → `info.fromModel = personality.model`, no compose with prior guest note; `composeQuotaFallbackInfo` exists but is only wired at `GenerationStep.ts:188` (a different call site), not here.
---
<!-- COMMENTS:END -->
