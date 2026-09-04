---
id: TASK-137
title: >-
  no-prod-import-test-factories depcruise rule lacks a packages/test-utils/
  exemption
status: To Do
assignee: []
created_date: '2026-06-03 00:00'
updated_date: '2026-09-04 19:43'
labels:
  - 'area:testing'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 137000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`no-prod-import-test-factories` depcruise rule lacks a `packages/test-utils/` exemption

**Why:** test-utils may someday legitimately re-export test-factories mock utilities; the rule's `pathNot` would need `^packages/test-utils/` added. **Promote when**: test-utils gains a test-factories import and the rule fires. Surfaced by PR #1147 claude-review. Deferred 2026-06-03.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:43
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: ARCHIVED. admission bar (06-backlog.md: there is deliberately no state for the-only-trigger-is-next-time-someone-touches-this; a task in it should never have been filed). The trigger event and the need are the same diff: a test-factories import from test-utils fails depcruise loudly at that moment.
---
<!-- COMMENTS:END -->
