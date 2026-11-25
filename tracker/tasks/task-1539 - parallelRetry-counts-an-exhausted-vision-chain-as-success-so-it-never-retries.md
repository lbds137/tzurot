---
id: TASK-1539
title: parallelRetry counts an exhausted vision chain as success, so it never retries
status: To Do
assignee: []
created_date: '2026-11-25T08:35:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1539000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/ai-worker/src/utils/parallelRetry.ts treats any resolved value as success, and an exhausted vision walk resolves to an [Image unavailable] placeholder rather than throwing. Prod 2026-11-24: the log line reported 20/20 succeeded while 8 images had exhausted on HTTP 429, so the parallel retry layer never re-attempted them.

What: let the vision path signal exhaustion to parallelRetry (a typed exhausted outcome or a predicate) so an all-tiers-failed attachment gets one delayed re-attempt after the concurrency burst clears; keep the success count honest in the log.

Acceptance: a test where every tier fails on the first pass and succeeds on the retry yields a real description; the retry summary counts exhausted placeholders as failures.
<!-- SECTION:DESCRIPTION:END -->
