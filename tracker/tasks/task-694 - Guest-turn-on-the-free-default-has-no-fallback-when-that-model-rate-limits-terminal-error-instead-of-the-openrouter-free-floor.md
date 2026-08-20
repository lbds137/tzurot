---
id: TASK-694
title: >-
  Guest turn on the free default has no fallback when that model rate-limits -
  terminal error instead of the openrouter/free floor
status: To Do
assignee: []
created_date: '2026-08-20 03:15'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 694000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: observed in prod 2026-08-19/20 (owner report + screenshot, ref mt0x7rafokw; corroborated episodes at 2026-08-20T00:02:55Z and 00:19:43Z UTC in ai-worker logs). Guest turns are proactively substituted to the free default (z-ai/glm-5.2:free at incident time); that model returned upstream 429s (Decart shared pool) through all 3 retries, RateLimitCache then stored (system, z-ai/glm-5.2:free) for ~15min, and every guest turn in the window died terminal - either the exhausted RetryError or the cache-hit "Rate limit cached" ApiError. No hop to the free floor happened.

Mechanism (code-read, corroborated by absent retarget logs): selectQuotaFallbackTarget (services/ai-worker/src/services/quotaFallback.ts, the isGuestMode arm) resolves the retarget candidate via resolveGuestSafeFreeDefault - but the failing model IS the free default on a proactively-substituted guest turn, so the config.model === failingModel guard returns null and quotaFallbackRunner rethrows the original error. The floor (selectFloorTarget guest arm = getFreeTextFloor() = openrouter/free, viability-checked under system) is only reachable through attemptFloorHop AFTER a hop-1 retarget attempt, and a guest at the default can never have a hop-1 target. Non-guest users whose global default is the failing model dead-end the same way (their floor: fallbackTextModel).

Fix shape: in quotaFallbackRunner, when selectQuotaFallbackTarget returns null (or returns the failing model), attempt selectFloorTarget({ excludeModels: [failingModel] }) before rethrowing - reusing the existing hop-2 machinery so viability checks and credentials resolution stay coherent. Distinct from TASK-645 (hop-1 RETRY failing unclassifiably); this is hop-1 having NO TARGET.

Acceptance: a guest turn whose free-default model is rate-limited (live 429 or cached) retargets to the free floor and answers, pinned by a test driving the runner with failingModel === free default; the same shape covered for the non-guest global-default case or explicitly dispositioned.
<!-- SECTION:DESCRIPTION:END -->
