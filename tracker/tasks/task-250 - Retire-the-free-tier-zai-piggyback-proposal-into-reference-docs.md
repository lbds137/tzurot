---
id: TASK-250
title: Retire the free-tier-zai-piggyback proposal into reference docs
status: To Do
assignee: []
created_date: '2026-07-11 00:00'
updated_date: '2026-07-28 10:51'
labels:
  - 'area:docs'
  - 'origin:review'
  - 'size:S'
dependencies: []
priority: low
ordinal: 250000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Retire the free-tier-zai-piggyback proposal into reference docs — The proposal shipped (slice 2) but holds the only record of the probe-verified z.ai quota-endpoint response shape and the 429 business-code table — reviewer flagged it now sits as a completed proposal instead of reference material. **Fix shape**: move the endpoint shape + code table into `docs/reference/` (likely alongside REASONING_MODEL_FORMATS-style provider references), then delete the proposal per the doc lifecycle rule. **Promote when**: after the dev-enable observation window confirms the endpoint shape is stable (one poll cycle of real use). Surfaced 2026-07-11 (PR #1584 round-2 review).

**Why:** Doc-lifecycle hygiene without losing the only shape record.
<!-- SECTION:DESCRIPTION:END -->
