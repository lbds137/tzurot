---
id: TASK-1486
title: >-
  ApiKeyResolver treats a failed Prisma read as no key, so a DB blip silently
  demotes BYOK users and caches it
status: Done
assignee: []
created_date: '2026-11-21T00:26:00Z'
updated_date: '2026-11-21T18:39:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: high
ordinal: 1486000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: getUserApiKey (services/ai-worker/src/services/ApiKeyResolver.ts, the Prisma try block) returns null when findFirst throws, so resolveApiKey falls back to the system key / guest mode and caches that result (cache.set in the same file) for the TTL. A transient DB failure therefore silently moves a BYOK user onto free models, the same silent-demotion class TASK-1359 fixed for decrypt failures. Kept out of TASK-1359 deliberately (its brief requirement 4); raised by the council GPT review of that PR.

What: distinguish confirmed absence (query returned null) from a lookup failure: throw a distinct ApiKeyLookupError (or treat it as retryable), never cache the fallback, and decide the job behaviour (retryable vs fail).

Acceptance: a test where findFirst rejects asserts no guest/system fallback is returned or cached; the job is retryable or fails loudly per the decision.
<!-- SECTION:DESCRIPTION:END -->
