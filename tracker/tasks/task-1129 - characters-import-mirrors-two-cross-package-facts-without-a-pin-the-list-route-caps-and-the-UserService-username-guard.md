---
id: TASK-1129
title: >-
  characters:import mirrors two cross-package facts without a pin: the
  list-route caps and the UserService username guard
status: To Do
assignee: []
created_date: '2026-09-27 18:01'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1122000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/tooling/src/characters/import.ts mirrors api-gateway list.ts take caps (NON_OWNER_PRIVATE_ROSTER_CAP = 100 and the inline 500-row abort), and gateway-client.ts getUserClientForEnv has a doc comment asserting UserService never upgrades the synthetic username (UserService.ts placeholder-username guard). Both were verified by reading in PR #2551 review, but nothing fails if either side changes. The SIMPLE_FIELDS drift test in classify.test.ts is the precedent.

What: add source-reading drift tests (or shared exported constants) for the two list caps, and a test or hedge for the UserService claim.

Acceptance: changing a list.ts take cap, or the UserService username-upgrade condition, turns a tooling test red.
<!-- SECTION:DESCRIPTION:END -->
