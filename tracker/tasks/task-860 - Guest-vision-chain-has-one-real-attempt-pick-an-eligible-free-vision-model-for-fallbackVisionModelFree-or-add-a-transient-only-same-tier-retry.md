---
id: TASK-860
title: >-
  Guest vision floor (openrouter/free) eligibility is circumstantial: watch for
  it returning; retry and hand-picked-model shapes ruled out
status: To Do
assignee: []
created_date: '2026-09-02 01:36'
updated_date: '2026-09-02 01:48'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 860000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: for a guest, every non-primary vision tier is forced to the free floor by resolveVisionAuth (services/ai-worker/src/services/multimodal/visionAuthResolver.ts, guest branch) and the walk dedups by resolved model, so a guest gets at most two distinct attempts: the flash piggyback (if admitted) and the free floor. The free floor is openrouter/free, which TASK-791 records as returning 404 (no endpoint eligible under the owner data-policy settings), so in practice a guest has ONE real attempt. Owner thought (2026-09-01): free users should maybe still get 3 attempts total, which would mean retrying a tier.

Assessment: attempt COUNT is the wrong lever. A same-tier retry only helps on transient categories (429 / 5xx / timeout); the two failures actually observed (flash moderation refusal, free-router no-endpoint 404) return the same answer twice. The lever is a second DISTINCT free-eligible model.

Fix shape, owner decision:
(a) zero code: set the fallbackVisionModelFree system setting to a specific free vision model on OpenRouter that is eligible under the data policy (getFreeVisionFloor in services/ai-worker/src/services/freeFloors.ts accepts any value passing isFreeModel). Guests then get two genuinely different models. Needs the owner to pick the model; the agent can check eligibility against the OpenRouter model list.
(b) code: a transient-only (RATE_LIMIT / SERVER_ERROR / TIMEOUT) single retry of the same tier inside walkFallbackChain, bounded so the worst case stays at MAX_VISION_FALLBACK_TIERS + 1 calls. Only worth it if (a) yields no eligible model.

Acceptance: a guest image whose flash tier fails on a non-image-bound category reaches a second distinct model, observed in prod logs (VisionFallbackLoop tiers list has two resolved models for a guest walk).

### Owner correction 2026-09-02 — the free-floor failure is circumstantial, not structural; this is a WATCH

The premise above ("in practice a guest has ONE real attempt") holds only under present OpenRouter conditions. Providers on OpenRouter come and go and change their data policies; openrouter/free has served guest vision before and can again without any change on our side. Consequences for the two fix shapes:

- (a) is ruled out as fragile in the same way: a hand-picked free model is subject to the same provider churn as the router, just less visibly, and it would have to be re-picked by hand every time. The router alias is the self-healing choice — it resolves against whatever is eligible at call time — so the guest floor stays openrouter/free.
- (b) stays ruled out on the original grounds (attempt count is not the lever).

No code change. State is observable: the signal is the prod VisionFallbackLoop log for a guest walk. With PR #2295 the free router's failure reason is classified per occurrence (a 200-with-error body now surfaces the body's error and provider), so the day eligibility returns shows up as a guest walk whose openrouter/free tier resolves a description instead of model_not_found. Close this task on that observation; re-open the discussion only if a guest walk fails on a category a retry could have helped (429 / 5xx / timeout) at a rate worth measuring.
<!-- SECTION:DESCRIPTION:END -->
