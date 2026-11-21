---
id: TASK-1490
title: >-
  attachmentProvenance tests: astral Cf row and an invariant-only real-timers
  comment
status: To Do
assignee: []
created_date: '2026-11-21T03:31:00Z'
labels:
  - area:common-types
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1490000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2775 (TASK-1375) review round 5 left two test nits. The format-character table in packages/common-types/src/utils/attachmentProvenance.test.ts has only BMP rows, so the surrogate-pair path of \p{Cf} under the u flag is unpinned (the reviewer probed U+E0001 and it works). The linear-time block comment says no test uses fake timers today, a statement about the file state that ages.

What: add an astral Cf row (U+E0001) to the table; reword the beforeEach comment to state only the invariant (wall-clock timing needs real timers).

Acceptance: the astral row passes on the fixed regex; the comment carries no present-state claim.
<!-- SECTION:DESCRIPTION:END -->
