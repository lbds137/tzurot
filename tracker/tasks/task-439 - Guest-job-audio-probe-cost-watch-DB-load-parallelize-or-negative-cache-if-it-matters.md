---
id: TASK-439
title: >-
  Guest-job audio-probe cost: watch DB load, parallelize or negative-cache if it
  matters
status: To Do
assignee: []
created_date: '2026-08-05 12:50'
updated_date: '2026-08-05 13:28'
labels:
  - 'area:ai-worker'
  - 'area:db'
  - 'size:S'
dependencies: []
priority: low
ordinal: 439000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #1974 removed the chat-guest short-circuit in AuthStep.resolveAudioProviderKeys, so EVERY chat-guest job now runs the ElevenLabs+Mistral key lookups - two sequential, never-cached DB reads (NoApiKeyAvailableError throw path has no cacheResult), previously skipped for the whole guest population. Reviewer sized this as a real multiplier on DB query volume at scale, informational at current volume.
Observable: pool-saturation warns (DATABASE_POOL_STATS_INTERVAL_MS gauge) or a visible bump in generation-path DB latency post-deploy.
Fix shape if it fires: Promise.all the two independent lookups in the provider loop (halves added latency), and/or a short-TTL negative-result cache in ApiKeyResolver for the no-key case.
Acceptance: either the observable stays quiet for a release cycle (close as noise) or one of the fix shapes ships with before/after numbers.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Mechanism sharpened by #1974 review round 3 (verified against ApiKeyResolver source): the cost is an UNCACHED EXCEPTION path - cacheResult runs only on success branches, and Mistral has NO system fallback (getSystemApiKey returns null unconditionally), so every keyless guest job re-throws NoApiKeyAvailableError and re-hits prisma.userApiKey.findFirst forever; ElevenLabs caches only if an operator system key is configured. The Promise.all half of the fix shape is shipping as an immediate fast-follow PR (two reviews converged on it); this task then owns only the negative-cache decision, still gated on the observable.

Promise.all half SHIPPED in #1975 (merged 2026-08-05; concurrency + isolation both test-pinned). Remaining scope: the negative-result cache decision only, gated on the observable above.
<!-- SECTION:NOTES:END -->
