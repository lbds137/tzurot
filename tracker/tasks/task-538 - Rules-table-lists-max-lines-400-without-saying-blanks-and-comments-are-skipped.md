---
id: TASK-538
title: Rules table lists max-lines 400 without saying blanks and comments are skipped
status: Done
assignee: []
created_date: '2026-08-12 00:33'
updated_date: '2026-08-12 07:44'
labels:
  - 'area:docs'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 538000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the ESLint Limits table in 02-code-standards lists max-lines 400 Error with no note that the rule runs with skipBlankLines and skipComments. A reader measuring with wc -l concludes a comment-heavy file is over the limit when its counted size is less than half of it. That happened on PR 2068: a 395-raw-line file counted 196, and an unnecessary module extraction was performed and justified in the PR body on the false premise, which two review rounds then accepted as accurate.

What: annotate the max-lines row (and max-lines-per-function, same options) with the skip settings, and add one line saying wc -l is not the metric and pnpm lint is the arbiter. Reference: eslint.config.js line 382.

Acceptance: a reader of the table cannot conclude raw line count is what the rule enforces.

Blocker: .claude/rules edits are review-gated and excluded by the current Opus-5 orchestrator trial boundaries. Ride the next rules PR alongside TASK-520, TASK-523, TASK-531, TASK-537.
<!-- SECTION:DESCRIPTION:END -->
