---
id: TASK-350
title: 'Co-ownership: confirm grant-arm semantics in the delete warning'
status: To Do
assignee: []
created_date: '2026-07-29 02:04'
updated_date: '2026-09-04 20:08'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 350000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced by the #1847 round-3 review. countCrossUserReach counts a user the moment a personality_owners grant row exists, activity or not — correct for the retention re-home call (erring toward re-homing is safe) but worth an explicit product decision for the self-serve DELETE WARNING: should "granted but never touched" count as an affected user there? Inert today (sole writer inserts owner self-duplicates, filtered by the inequality). Promote when: real co-ownership grants ship — fold this into that feature design; the reach module doc comment flags the same seam.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:08
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-50 (Idea Deliberate character co ownership — invite accept revoke owner directive 2026 07 25); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-350 finds it.
---
<!-- COMMENTS:END -->
