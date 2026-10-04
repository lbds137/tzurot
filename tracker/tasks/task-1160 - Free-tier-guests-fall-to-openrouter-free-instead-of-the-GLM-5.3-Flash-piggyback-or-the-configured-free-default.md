---
id: TASK-1160
title: >-
  Free-tier guests fall to openrouter/free instead of the GLM 5.3 Flash
  piggyback or the configured free default
status: Done
assignee: []
created_date: '2026-10-04 16:45'
updated_date: '2026-10-04 22:05'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1152000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner report 2026-10-04 (own words, apostrophe dropped): "GLM 5.3 Flash isnt sticking as a free model at inference time anymore. bot ends up using openrouter/free as a fallback unless the global free default is set to a specific OpenRouter model". Prod behaviour, not reproduced yet. Not fixed here; this entry names where to look. HYPOTHESES (code-reading only, none runtime-confirmed): the guest ladder in services/ai-worker/src/jobs/handlers/pipeline/steps/guestModeOverrides.ts is personal selection -> admin free default (LlmConfigResolver.getFreeDefaultConfig, packages/config-resolver/src/LlmConfigResolver.ts:184) -> getFreeTextFloor() (services/ai-worker/src/services/freeFloors.ts) which is FREE_ROUTER_MODEL openrouter/free. The z.ai piggyback model glm-5.3-flash (ZAI_FREE_TIER_MODEL, packages/common-types/src/constants/ai.ts:869) is NOT free on OpenRouter (isFreeModel false) so it only survives if ZaiFreeTierAdmission (services/ai-worker/src/services/ZaiFreeTierAdmission.ts) admits; denial is SILENT by design and drops to the router. Five deny reasons: disabled (zaiFreeTierEnabled off or system key missing), kill-switch, window-exhausted cooldown, headroom (plan usage over zaiHeadroomPercent), quota (per-user and global-daily share). Candidate causes in order of cheapness to check: (a) the zaiFreeTierEnabled setting or ZAI key absent in the environment; (b) the headroom meter (ZaiPlanMeter) reading over the percent, since it counts the owner own coding and extraction; (c) the exhausted-cooldown or kill-switch Redis keys set; (d) the free-default pointer null or pointing at the piggyback preset, so the fallback goes straight to the router (guestModeOverrides.ts:130-146 does exactly that when the free default is the piggyback and admission denies). Related: quotaFallback.ts:322-341 degrades a non-free free default to the floor too.
First step: read the prod log lines "z.ai free-tier denied" (reason field) and "Guest mode: overriding paid model with free model" for a recent guest turn; the reason names which of the five gates fired.
Acceptance: root cause named with a log line; either the admission gate is corrected or the owner is told it is working as designed (silent denial) and the free-default setting to use; consider surfacing the deny reason in the reply footer if users cannot tell. Related tasks: TASK-860 (guest vision floor watch), TASK-188.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Root cause (prod ai-worker logs, 2026-10-04 03:14Z-22:03Z window): working as designed. All 10 piggyback denials in the window were reason=headroom: ZaiFreeTierAdmission logged consumedPct=95 headroomPercent=75 resetAt=2026-10-08T02:22:18Z on every guest turn from 14:18Z on. The z.ai coding plan weekly window is shared with owner GLM coding sessions plus extraction and archive-summary jobs (logged provider=zai-coding model=z-ai/glm-5.3), so the GLM-driven week consumed it past the 75% guard. Second hop: the configured free default qwen/qwen3.8-27b:free then took an OpenRouter 429 on 7 of the 12 overridden guest turns (QuotaFallback category=rate_limit, "No hop-1 retarget available — promoting the floor"), which is why openrouter/free answered even with a specific free default set. No gate defect. The piggyback reopens at the plan reset (2026-10-07 22:22 EDT) or if zaiHeadroomPercent is raised. Silent-denial UX follow-up filed as TASK-1171 (owner question).
<!-- SECTION:FINAL_SUMMARY:END -->
