---
id: TASK-1570
title: 'Tier seam: effective-tier resolver, D10 firewall restore, per-key demotion'
status: In Progress
assignee:
  - tzurot-A
created_date: '2026-11-27T06:01:00Z'
labels:
  - area:ai-worker
  - size:L
  - state:ready
dependencies: []
priority: high
ordinal: 1560000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod 402 incident 11-27 - an authenticated free-tier user hit the PAID floor on the system OpenRouter key (quotaFallback.ts:342 keys on isGuestMode; its doc at :322-326 already states the D10 split) and the drained system workspace 402d both hops; no reply. Lila rulings via Deck: full D10 firewall (free/keyless never bill system OpenRouter on any hop); promotion runs only on the user own stored z.ai coding key, else skipped; per-key low-credit demotion INCLUDING BYOK keys (a key out of credit or erroring demotes that key to the free cascade until it recovers); low-credit requests try glm-5.3-flash z.ai-direct via the guarded piggyback, never OpenRouter. Structural ask: tier decided in ONE seam, not re-derived per site; full edge-case matrix as one table-driven test; a structural guard so new features cannot re-derive tier. Visibility ruling (Lila 11-27 via Deck, AUQ): footer-only disclosure - the existing footer announce covers demotion, no new UI.
What: PR 1 - resolveEffectiveTier computed once in AuthStep and carried on the auth object; re-key selectFloorTarget, hopOneFloorTarget, the free-ladder trigger and the promotion (own zai key else piggyback-admitted else none); matrix rows for the none/ok key states across guest/free/paid-system/BYOK x chat/promote/floor; dependency-cruiser import guard on the tier primitives. PR 2 - per-key demotion state machine: 402/401 classifier marks flip the tier per key (CreditExhaustionCache buckets, reactive TTL, no balance probe), recovery on expiry, matrix extension with low-credit/402/401/429/provider-down rows and vision/caption/retry paths.
Acceptance: a keyless free-tier request never reaches a system-key-billed model on either hop (regression test); a BYOK 402 demotes only that key; a low-credit request routes glm-5.3-flash z.ai-direct through the guarded piggyback, never OpenRouter; every matrix row the current code fails is enumerated as a finding in the PR 1 body.
<!-- SECTION:DESCRIPTION:END -->
