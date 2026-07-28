---
id: TASK-137
title: >-
  no-prod-import-test-factories depcruise rule lacks a packages/test-utils/
  exemption
status: To Do
assignee: []
created_date: '2026-06-03 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:testing'
  - 'size:S'
dependencies: []
priority: low
ordinal: 137000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`no-prod-import-test-factories` depcruise rule lacks a `packages/test-utils/` exemption

**Why:** test-utils may someday legitimately re-export test-factories mock utilities; the rule's `pathNot` would need `^packages/test-utils/` added. **Promote when**: test-utils gains a test-factories import and the rule fires. Surfaced by PR #1147 claude-review. Deferred 2026-06-03.
<!-- SECTION:DESCRIPTION:END -->
