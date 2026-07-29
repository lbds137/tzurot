---
id: TASK-219
title: Retire the BullMQ context schema's legacy tolerance once safe
status: Done
assignee: []
created_date: '2026-07-06 00:00'
updated_date: '2026-07-29 23:36'
labels:
  - 'area:bot-client'
  - 'area:common-types'
  - 'area:testing'
  - 'area:jobs'
  - 'area:redis'
  - 'size:S'
dependencies: []
priority: low
ordinal: 219000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Retire the BullMQ context schema's legacy tolerance once safe

**Why:** `jobContextBaseSchema` keeps `kind: z.enum(['legacy','envelope']).default('legacy')` so pre-cutover jobs already queued in Redis still parse — but bot-client has shipped envelope-only since the cutover, and the worker's ContextStep hard-rejects legacy anyway, so the tolerance now only delays the failure from ValidationStep to ContextStep. The contract suite (2026-07-06) PINS the current tolerated-but-rejected behavior explicitly (legacy fixtures asserted schema-pass + ContextStep-reject). Tightening = require `kind:'envelope'` at the schema, drop the default, delete the legacy fixtures' reject-pin. **Promote when**: any maintenance window that drains the queues (no pre-cutover job can survive one), or the next jobs.ts schema touch. Ride-alongs for the same touch (review nits, PR #1509 round 5): a one-line comment in `test-utils/jobContextArbitraries.ts` noting the `'image/'`/`'audio/'` literals mirror `CONTENT_TYPES.IMAGE_PREFIX`/`AUDIO_PREFIX` (deliberate no-common-types posture, greppability aid); drop the redundant `as LLMGenerationJobData` cast in the pipeline consumer test; consider wiring `legacyContextArb` into a property when the retirement lands (it currently only self-tests). Surfaced 2026-07-06 (contract-suite exploration: the three-tier width mismatch).
<!-- SECTION:DESCRIPTION:END -->
