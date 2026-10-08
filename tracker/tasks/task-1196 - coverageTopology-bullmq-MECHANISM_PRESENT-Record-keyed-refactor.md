---
id: TASK-1196
title: 'coverageTopology bullmq MECHANISM_PRESENT: Record-keyed refactor'
status: To Do
assignee: []
created_date: '2026-10-08 21:56'
labels:
  - 'area:ci'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
type: task
ordinal: 1186000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
why: PR 2587 round-3 review — the bullmq-contract branch is now a 3-deep nested ternary (broadcast -> retention -> catalogDrift -> default); a 4th job type makes it 4-deep and hard to read.
what: refactor MECHANISM_PRESENT[bullmq-contract] to a Record keyed by schemaRef with a default fallback when the next job type lands.
acceptance: topology:check + coverageTopology.test.ts green; no behavioral change.
Promote when: the next BullMQ job-type addition (job type 4).
<!-- SECTION:DESCRIPTION:END -->
