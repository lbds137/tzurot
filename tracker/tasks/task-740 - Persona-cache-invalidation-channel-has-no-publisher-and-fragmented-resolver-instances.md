---
id: TASK-740
title: >-
  Persona cache-invalidation channel has no publisher and fragmented resolver
  instances
status: Done
assignee: []
created_date: '2026-08-23 03:44'
updated_date: '2026-08-23 13:35'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 740000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: class sweep after TASK-739 (stale cached read gates behavior). PersonaCacheInvalidationService is subscribed in ai-worker (services/ai-worker/src/cacheInvalidation.ts:113-124, logs "initialized with cache invalidation") but NOTHING publishes on that channel: persona create/update/delete (services/api-gateway/src/routes/user/persona/crud.ts:162,234,269) and the per-personality persona override (services/api-gateway/src/routes/user/persona/override.ts:154,220,289) call no invalidation. Additionally the subscribed resolver instance is NOT the one the hot path uses - contextStepFactory.ts:38 and MemoryRetriever.ts:128 construct their own PersonaResolver, so eviction would miss them even with a publisher (the locally-constructed-fallback anti-pattern routeDeps.ts documents for cascadeResolver).

Severity is LOW today because every PersonaResolver is constructed bare -> BaseConfigResolver default TTL = INTERVALS.API_KEY_CACHE_TTL = 10s (verified at packages/identity/src/resolvers/BaseConfigResolver.ts:105). The dead channel becomes a real bug the day anyone raises that TTL.

Fix shape (recommended): publish PersonaCacheInvalidationService from the persona write routes (mirror the stt/tts/llm sibling pattern via a RouteDeps field) AND consolidate ai-worker onto the one subscribed resolver instance; alternatively delete the dead subscription + its misleading log line. Either way the current half-wired state is the worst option.

Member (from the PR #2190 review, observation 1): AccountEraserService.ts:115 constructs a fresh UserCacheInvalidationService per call while the set-default route uses the injected singleton from createChannelInvalidationServices - unify AccountEraserService onto the injected pattern in the same wiring pass.

Acceptance: either every persona-input write publishes and one shared subscribed resolver serves the pipeline, or the subscription is gone; no log line claims invalidation that cannot fire.
<!-- SECTION:DESCRIPTION:END -->
