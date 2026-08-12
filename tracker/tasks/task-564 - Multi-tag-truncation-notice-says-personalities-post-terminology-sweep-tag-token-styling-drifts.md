---
id: TASK-564
title: >-
  Multi-tag truncation notice says personalities post-terminology-sweep; tag
  token styling drifts
status: To Do
assignee: []
created_date: '2026-08-12 22:34'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 564000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: multiTagDeliveryFlow.ts:177 renders "(Only the first N tagged personalities respond.)" - PR #2035 swept personality->character in user-facing surfaces, and #2033 rewrote this exact line for the configurable cap but kept the old noun. Owner-visible terminology drift on a prod-reachable string. Cosmetic sibling: the sampling notice renders the tag bare (carry fantasy) while the empty-pool message backticks it - two tag surfaces styling the same token differently.

Fix shape: personalities->characters in the notice; pick one tag-token style and apply to both.

Acceptance: grep for "personalities" in user-facing bot-client strings comes back empty. Source: 2026-08-12 review (tags reviewer F4, CONFIRMED). Good ride-along for TASK-558.
<!-- SECTION:DESCRIPTION:END -->
