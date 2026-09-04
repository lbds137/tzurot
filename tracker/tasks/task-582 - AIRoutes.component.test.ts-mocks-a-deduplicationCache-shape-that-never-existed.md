---
id: TASK-582
title: AIRoutes.component.test.ts mocks a deduplicationCache shape that never existed
status: To Do
assignee: []
created_date: '2026-08-13 11:13'
updated_date: '2026-09-04 19:37'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 582000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the file mocks ../../utils/deduplicationCache.js as { deduplicationCache: { get, set } }, but generate.ts imports the named function getDeduplicationCache. The mock factory does not export it, so any /generate case that reached the dedup line would throw TypeError: getDeduplicationCache is not a function. It has never matched the real module shape - not even the pre-reservation checkDuplicate/cacheRequest interface.

Currently inert and verified so: every /generate case in that file (empty body, requestId 123, missing personality, malformed JSON) fails generateRequestSchema.safeParse before reaching the dedup call. Confirmed independently by the PR 2085 reviewer.

Fix shape: correct the mock to export getDeduplicationCache returning an object with reserve/release, matching generate.test.ts. Landmine for whoever next adds a happy-path /generate case to this file - it will fail with a confusing TypeError rather than an obvious mock gap.

Acceptance: the mock shape matches the real module, and a happy-path /generate case can be added to the component file without touching the mock. Source: PR 2085 review round 3, Low.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `AIRoutes.component.test.ts:51` still mocks `deduplicationCache: { get, set }` while `generate.ts:11,76` imports and calls `getDeduplicationCache()` (with `.reserve`/`.release`). Confirmed inert today (every `/generate` case in that file fails schema validation before reaching the dedup line) and confirmed as a landmine for the next happy-path case added there. Evidence: `sed -n '50,56p' services/api-gateway/src/routes/ai/AIRoutes.component.test.ts` vs. `grep -n getDeduplicationCache services/api-gateway/src/routes/ai/generate.ts` → mock shape and real import diverge exactly as described.
---
<!-- COMMENTS:END -->
