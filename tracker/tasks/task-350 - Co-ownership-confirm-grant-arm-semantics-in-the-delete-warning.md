---
id: TASK-350
title: 'Co-ownership: confirm grant-arm semantics in the delete warning'
status: To Do
assignee: []
created_date: '2026-07-29 02:04'
updated_date: '2026-07-29 02:04'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 350000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced by the #1847 round-3 review. countCrossUserReach counts a user the moment a personality_owners grant row exists, activity or not — correct for the retention re-home call (erring toward re-homing is safe) but worth an explicit product decision for the self-serve DELETE WARNING: should "granted but never touched" count as an affected user there? Inert today (sole writer inserts owner self-duplicates, filtered by the inequality). Promote when: real co-ownership grants ship — fold this into that feature design; the reach module doc comment flags the same seam.
<!-- SECTION:DESCRIPTION:END -->
